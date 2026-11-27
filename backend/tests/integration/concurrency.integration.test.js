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
  barrier,
} = require('./helpers');
const UserService = require('../../src/modules/users/user.service');
const { startCoding } = require('../../src/modules/encounters');

describe('Integration: Real PostgreSQL Concurrency (Serializable & Unique Constraints)', () => {
  const tracker = createTracker();
  let adminToken;

  beforeAll(async () => {
    adminToken = (await loginSeededAdmin()).token;
  });

  afterEach(async () => {
    await cleanupTracked(tracker);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  test('Provider & Registration concurrency: duplicate NPI and duplicate normalized email allow at most one record', async () => {
    const tag = uniqueTag('conc');
    const sharedNpi = uniqueNpi();

    const waitProv = barrier(2);
    const provResults = await Promise.allSettled([
      (async () => {
        await waitProv();
        return request(app)
          .post('/api/v1/providers')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: `Conc Prov A ${tag}`, npi: sharedNpi, specialty: 'Cardiology' });
      })(),
      (async () => {
        await waitProv();
        return request(app)
          .post('/api/v1/providers')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: `Conc Prov B ${tag}`, npi: sharedNpi, specialty: 'Cardiology' });
      })(),
    ]);

    const provResponses = provResults.map((r) => r.value);
    const createdProviders = provResponses.filter((r) => r.status === 201);
    const rejectedProviders = provResponses.filter((r) => r.status === 409);
    createdProviders.forEach((r) => tracker.providerIds.push(r.body.data.provider.id));
    expect(createdProviders.length).toBe(1);
    expect(rejectedProviders.length).toBe(1);

    const sharedEmail = `${tag}@medcodeai.test`;
    const waitReg = barrier(2);
    const regResults = await Promise.allSettled([
      (async () => {
        await waitReg();
        return request(app).post('/api/v1/auth/register').send({
          name: 'Conc Reg A',
          email: sharedEmail.toUpperCase(),
          password: 'ConcPassword#2026!',
        });
      })(),
      (async () => {
        await waitReg();
        return request(app).post('/api/v1/auth/register').send({
          name: 'Conc Reg B',
          email: `  ${sharedEmail}  `,
          password: 'ConcPassword#2026!',
        });
      })(),
    ]);

    const regResponses = regResults.map((r) => r.value);
    const createdRegs = regResponses.filter((r) => r.status === 201);
    const rejectedRegs = regResponses.filter((r) => r.status === 409);
    createdRegs.forEach((r) => tracker.userIds.push(r.body.data.user.id));
    expect(createdRegs.length).toBe(1);
    expect(rejectedRegs.length).toBe(1);
  });

  test('Password concurrency: two simultaneous password changes with the same old password cannot both succeed', async () => {
    const { user, password } = await createSyntheticUser(tracker, 'CODER');
    const waitPw = barrier(2);

    const results = await Promise.allSettled([
      (async () => {
        await waitPw();
        return UserService.changePassword(
          user.id,
          { currentPassword: password, newPassword: 'FirstNewPassword#2026!' },
          { userId: user.id, role: 'CODER', ipAddress: '127.0.0.1' }
        );
      })(),
      (async () => {
        await waitPw();
        return UserService.changePassword(
          user.id,
          { currentPassword: password, newPassword: 'SecondNewPassword#2026!' },
          { userId: user.id, role: 'CODER', ipAddress: '127.0.0.1' }
        );
      })(),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser.tokenVersion).toBe(1);
  });

  test('Administrator concurrency: concurrent mutual demotions/disables preserve at least one active approved ADMIN', async () => {
    const { user: adminA, password: pwA } = await createSyntheticUser(tracker, 'ADMIN');
    const { user: adminB, password: pwB } = await createSyntheticUser(tracker, 'ADMIN');
    const tokenA = (await loginUser(adminA.email, pwA)).body.data.token;
    const tokenB = (await loginUser(adminB.email, pwB)).body.data.token;

    const waitAdmin = barrier(2);
    await Promise.allSettled([
      (async () => {
        await waitAdmin();
        return request(app)
          .patch(`/api/v1/users/${adminB.id}/status`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ isActive: false });
      })(),
      (async () => {
        await waitAdmin();
        return request(app)
          .patch(`/api/v1/users/${adminA.id}/status`)
          .set('Authorization', `Bearer ${tokenB}`)
          .send({ isActive: false });
      })(),
    ]);

    const activeAdmins = await prisma.user.count({
      where: { isActive: true, accountStatus: 'APPROVED', role: { name: 'ADMIN' } },
    });
    expect(activeAdmins).toBeGreaterThanOrEqual(1);
  });

  test('Encounter concurrency: simultaneous startCoding transitions cannot both succeed', async () => {
    const { user: coder } = await createSyntheticUser(tracker, 'CODER');
    const patient = await prisma.patient.findFirst();
    const provider = await prisma.provider.findFirst();
    const plan = await prisma.insurancePlan.findFirst();

    const enc = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        providerId: provider.id,
        payerId: plan.payerId,
        planId: plan.id,
        encounterDate: new Date('2026-10-05'),
        placeOfService: '11',
        status: 'OPEN',
      },
    });
    tracker.encounterIds.push(enc.id);

    const record = await prisma.medicalRecord.create({
      data: {
        encounterId: enc.id,
        uploadedBy: coder.id,
        filePath: `/synthetic/${uniqueTag('conc_rec')}.pdf`,
        fileType: 'application/pdf',
      },
    });
    tracker.medicalRecordIds.push(record.id);

    const waitEnc = barrier(2);
    const results = await Promise.allSettled([
      (async () => {
        await waitEnc();
        return startCoding(enc.id, { userId: coder.id, role: 'CODER', ipAddress: '127.0.0.1' });
      })(),
      (async () => {
        await waitEnc();
        return startCoding(enc.id, { userId: coder.id, role: 'CODER', ipAddress: '127.0.0.1' });
      })(),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);

    const dbEnc = await prisma.encounter.findUnique({ where: { id: enc.id } });
    expect(dbEnc.status).toBe('CODING_IN_PROGRESS');
  });
});
