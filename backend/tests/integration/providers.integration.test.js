const {
  app,
  prisma,
  disconnectPrisma,
  request,
  uniqueTag,
  uniqueNpi,
  createTracker,
  cleanupTracked,
  loginSeededAdmin,
  createSyntheticUser,
  loginUser,
} = require('./helpers');

describe('Integration: Providers (Real PostgreSQL)', () => {
  const tracker = createTracker();
  let adminToken;
  let coderToken;
  let reviewerToken;

  beforeAll(async () => {
    adminToken = (await loginSeededAdmin()).token;
    const { user: coder, password: coderPw } = await createSyntheticUser(tracker, 'CODER');
    coderToken = (await loginUser(coder.email, coderPw)).body.data.token;
    const { user: reviewer, password: revPw } = await createSyntheticUser(tracker, 'REVIEWER');
    reviewerToken = (await loginUser(reviewer.email, revPw)).body.data.token;
  });

  afterAll(async () => {
    await cleanupTracked(tracker);
    await disconnectPrisma();
  });

  test('Creates, preserves leading-zero NPI, searches/filters/paginates, updates, blocks duplicate/dependent delete, and enforces PG unique NPI', async () => {
    const tag = uniqueTag('prov');
    const leadingZeroNpi = `00${uniqueNpi().slice(2)}`;

    // Unauthorized & forbidden (REVIEWER cannot access /providers)
    expect((await request(app).get('/api/v1/providers')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/providers')
          .set('Authorization', `Bearer ${reviewerToken}`)
          .send({ name: 'Forbidden', npi: leadingZeroNpi, specialty: 'Cardiology' })
      ).status
    ).toBe(403);

    // Invalid NPI rejected
    expect(
      (
        await request(app)
          .post('/api/v1/providers')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: 'Bad NPI', npi: '123', specialty: 'Cardiology' })
      ).status
    ).toBe(400);

    // Create provider with leading-zero NPI
    const create1 = await request(app)
      .post('/api/v1/providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Dr. Integration ${tag}`,
        npi: leadingZeroNpi,
        specialty: `Cardio-${tag}`,
      });
    expect(create1.status).toBe(201);
    const prov1Id = create1.body.data.provider.id;
    tracker.providerIds.push(prov1Id);
    expect(create1.body.data.provider.npi).toBe(leadingZeroNpi);

    // Duplicate NPI rejected by API
    const dupRes = await request(app)
      .post('/api/v1/providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Duplicate NPI',
        npi: leadingZeroNpi,
        specialty: 'Neurology',
      });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('DUPLICATE_NPI');

    // Duplicate NPI also enforced directly at PostgreSQL unique constraint level
    await expect(
      prisma.provider.create({
        data: { name: 'Direct PG Dup', npi: leadingZeroNpi, specialty: 'Neurology' },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    // Create second provider for pagination & clean delete
    const secondNpi = uniqueNpi();
    const create2 = await request(app)
      .post('/api/v1/providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Dr. Second ${tag}`,
        npi: secondNpi,
        specialty: `Cardio-${tag}`,
      });
    expect(create2.status).toBe(201);
    const prov2Id = create2.body.data.provider.id;
    tracker.providerIds.push(prov2Id);

    // Search, specialty filter, pagination, nonexistent 404
    const listRes = await request(app)
      .get(`/api/v1/providers?search=${tag}&specialty=Cardio-${tag}&page=1&limit=1`)
      .set('Authorization', `Bearer ${coderToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.meta.total).toBe(2);

    expect(
      (
        await request(app)
          .get('/api/v1/providers/99999999')
          .set('Authorization', `Bearer ${coderToken}`)
      ).status
    ).toBe(404);

    // Empty PATCH rejected, valid PATCH succeeds
    expect(
      (
        await request(app)
          .patch(`/api/v1/providers/${prov1Id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({})
      ).status
    ).toBe(400);

    const updRes = await request(app)
      .patch(`/api/v1/providers/${prov1Id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Dr. Updated ${tag}` });
    expect(updRes.status).toBe(200);
    expect((await prisma.provider.findUnique({ where: { id: prov1Id } })).name).toBe(
      `Dr. Updated ${tag}`
    );

    // Dependent encounter blocks deletion
    const patient = await prisma.patient.findFirst();
    const plan = await prisma.insurancePlan.findFirst();
    const enc = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        providerId: prov1Id,
        payerId: plan.payerId,
        planId: plan.id,
        encounterDate: new Date('2026-10-02'),
        placeOfService: '11',
        status: 'OPEN',
      },
    });
    tracker.encounterIds.push(enc.id);

    const blockedDel = await request(app)
      .delete(`/api/v1/providers/${prov1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(blockedDel.status).toBe(409);

    // Clean delete succeeds
    const okDel = await request(app)
      .delete(`/api/v1/providers/${prov2Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(okDel.status).toBe(200);
    expect(await prisma.provider.findUnique({ where: { id: prov2Id } })).toBeNull();

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'PROVIDER', entityId: { in: [prov1Id, prov2Id] } },
    });
    expect(audits.some((a) => a.action === 'PROVIDER_CREATED')).toBe(true);
    expect(audits.some((a) => a.action === 'PROVIDER_UPDATED')).toBe(true);
    expect(audits.some((a) => a.action === 'PROVIDER_DELETED')).toBe(true);
  });
});
