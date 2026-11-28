const {
  app,
  prisma,
  disconnectPrisma,
  request,
  uniqueTag,
  createTracker,
  cleanupTracked,
  loginSeededAdmin,
  createSyntheticUser,
  loginUser,
} = require('./helpers');

describe('Integration: Patients (Real PostgreSQL)', () => {
  const tracker = createTracker();
  let adminToken;
  let coderToken;
  let reviewerToken;

  beforeAll(async () => {
    const admin = await loginSeededAdmin();
    adminToken = admin.token;

    const { user: coder, password: coderPw } = await createSyntheticUser(tracker, 'CODER');
    coderToken = (await loginUser(coder.email, coderPw)).body.data.token;

    const { user: reviewer, password: reviewerPw } = await createSyntheticUser(
      tracker,
      'REVIEWER'
    );
    reviewerToken = (await loginUser(reviewer.email, reviewerPw)).body.data.token;
  });

  afterAll(async () => {
    await cleanupTracked(tracker);
    await disconnectPrisma();
  });

  test('Creates, retrieves, searches, paginates, updates, and deletes patients with RBAC and audit checks', async () => {
    const tag = uniqueTag('pat');

    // Unauthenticated & forbidden
    expect((await request(app).get('/api/v1/patients')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/patients')
          .set('Authorization', `Bearer ${reviewerToken}`)
          .send({ name: 'Blocked', dob: '1990-01-01', gender: 'Female' })
      ).status
    ).toBe(403);

    // Invalid DOB / future date / invalid gender / unsupported fields
    expect(
      (
        await request(app)
          .post('/api/v1/patients')
          .set('Authorization', `Bearer ${coderToken}`)
          .send({ name: 'Bad DOB', dob: 'not-a-date', gender: 'Female' })
      ).status
    ).toBe(400);

    expect(
      (
        await request(app)
          .post('/api/v1/patients')
          .set('Authorization', `Bearer ${coderToken}`)
          .send({ name: 'Future DOB', dob: '2099-01-01', gender: 'Female' })
      ).status
    ).toBe(400);

    expect(
      (
        await request(app)
          .post('/api/v1/patients')
          .set('Authorization', `Bearer ${coderToken}`)
          .send({ name: 'Extra Field', dob: '1990-01-01', gender: 'InvalidGender', unknown: 1 })
      ).status
    ).toBe(400);

    // Create two patients sharing non-unique memberId (schema allows non-unique memberId)
    const sharedMemberId = `MEM-${tag}`;
    const create1 = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${coderToken}`)
      .send({
        name: `Patient Alpha ${tag}`,
        dob: '1985-04-12',
        gender: 'Female',
        memberId: sharedMemberId,
      });
    expect(create1.status).toBe(201);
    const pat1Id = create1.body.data.patient.id;
    tracker.patientIds.push(pat1Id);

    const create2 = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${coderToken}`)
      .send({
        name: `Patient Beta ${tag}`,
        dob: '1988-09-20',
        gender: 'Male',
        memberId: sharedMemberId,
      });
    expect(create2.status).toBe(201);
    const pat2Id = create2.body.data.patient.id;
    tracker.patientIds.push(pat2Id);

    // Retrieve & nonexistent 404 (CODER/BILLING_SPECIALIST/ADMIN allowed; REVIEWER forbidden)
    const get1 = await request(app)
      .get(`/api/v1/patients/${pat1Id}`)
      .set('Authorization', `Bearer ${coderToken}`);
    expect(get1.status).toBe(200);
    expect(get1.body.data.patient.memberId).toBe(sharedMemberId);

    expect(
      (
        await request(app)
          .get('/api/v1/patients/99999999')
          .set('Authorization', `Bearer ${coderToken}`)
      ).status
    ).toBe(404);

    // Search & pagination
    const listRes = await request(app)
      .get(`/api/v1/patients?search=${tag}&page=1&limit=1`)
      .set('Authorization', `Bearer ${coderToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.meta.total).toBe(2);

    // Update
    const updRes = await request(app)
      .patch(`/api/v1/patients/${pat1Id}`)
      .set('Authorization', `Bearer ${coderToken}`)
      .send({ name: `Patient Alpha Updated ${tag}` });
    expect(updRes.status).toBe(200);
    const dbPat1 = await prisma.patient.findUnique({ where: { id: pat1Id } });
    expect(dbPat1.name).toBe(`Patient Alpha Updated ${tag}`);

    // Block deletion when dependent encounter exists
    const provider = await prisma.provider.findFirst();
    const plan = await prisma.insurancePlan.findFirst();
    const enc = await prisma.encounter.create({
      data: {
        patientId: pat1Id,
        providerId: provider.id,
        payerId: plan.payerId,
        planId: plan.id,
        encounterDate: new Date('2026-10-01'),
        placeOfService: '11',
        status: 'OPEN',
      },
    });
    tracker.encounterIds.push(enc.id);

    const blockedDel = await request(app)
      .delete(`/api/v1/patients/${pat1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(blockedDel.status).toBe(409);
    expect(blockedDel.body.error.code).toBe('DEPENDENT_RECORDS_EXIST');

    // REVIEWER cannot delete; CODER/ADMIN can delete (clean pat2)
    expect(
      (
        await request(app)
          .delete(`/api/v1/patients/${pat2Id}`)
          .set('Authorization', `Bearer ${reviewerToken}`)
      ).status
    ).toBe(403);

    const okDel = await request(app)
      .delete(`/api/v1/patients/${pat2Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(okDel.status).toBe(200);
    expect(await prisma.patient.findUnique({ where: { id: pat2Id } })).toBeNull();

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'PATIENT', entityId: { in: [pat1Id, pat2Id] } },
    });
    expect(audits.some((a) => a.action === 'PATIENT_CREATED')).toBe(true);
    expect(audits.some((a) => a.action === 'PATIENT_UPDATED')).toBe(true);
    expect(audits.some((a) => a.action === 'PATIENT_DELETED')).toBe(true);
  });
});
