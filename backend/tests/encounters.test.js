process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long-12345';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    patient: { findUnique: jest.fn() },
    provider: { findUnique: jest.fn() },
    payer: { findUnique: jest.fn() },
    insurancePlan: { findUnique: jest.fn() },
    encounter: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    medicalRecord: { count: jest.fn() },
    validationResult: { count: jest.fn() },
    denialRisk: { count: jest.fn() },
    report: { count: jest.fn() },
    claim: { count: jest.fn() },
    auditLog: { create: jest.fn() },
  },
  checkDatabaseHealth: jest.fn(),
  disconnectPrisma: jest.fn(),
}));

const app = require('../src/app');
const { prisma } = require('../src/config/prisma');

function signToken(sub = '2') {
  return jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(sub),
    expiresIn: '1h',
    issuer: 'medcodeai-api',
    audience: 'medcodeai-client',
  });
}

function mockAuthUser(roleName = 'BILLING_SPECIALIST') {
  prisma.user.findUnique.mockResolvedValueOnce({
    id: 2,
    name: 'Billing User',
    email: 'billing@medcodeai.local',
    roleId: 2,
    isActive: true,
    accountStatus: 'APPROVED',
    role: { id: 2, name: roleName },
  });
}

describe('Encounters Module (Phase 7 / KAN-19)', () => {
  const token = signToken('2');

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Requires authentication (401) and rejects REVIEWER role (403)', async () => {
    expect((await request(app).get('/api/v1/encounters')).status).toBe(401);

    mockAuthUser('REVIEWER');
    expect(
      (await request(app).get('/api/v1/encounters').set('Authorization', `Bearer ${token}`)).status
    ).toBe(403);
  });

  test('Creates encounter with OPEN status, validates references & payer-plan match, and logs ENCOUNTER_CREATED', async () => {
    mockAuthUser('BILLING_SPECIALIST');
    prisma.patient.findUnique.mockResolvedValueOnce({ id: 1 });
    prisma.provider.findUnique.mockResolvedValueOnce({ id: 2 });
    prisma.payer.findUnique.mockResolvedValueOnce({ id: 3 });
    prisma.insurancePlan.findUnique.mockResolvedValueOnce({ id: 4, payerId: 3 });

    const created = {
      id: 20,
      patientId: 1,
      providerId: 2,
      payerId: 3,
      planId: 4,
      encounterDate: new Date('2026-10-01T00:00:00.000Z'),
      placeOfService: '11',
      status: 'OPEN',
    };
    const txAuditCreate = jest.fn().mockResolvedValueOnce({ id: 1 });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        encounter: { create: jest.fn().mockResolvedValueOnce(created) },
        auditLog: { create: txAuditCreate },
      })
    );

    const res = await request(app)
      .post('/api/v1/encounters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: 1,
        providerId: 2,
        payerId: 3,
        planId: 4,
        encounterDate: '2026-10-01',
        placeOfService: '11',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.encounter.status).toBe('OPEN');
    expect(txAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ENCOUNTER_CREATED',
        entity: 'ENCOUNTER',
        entityId: 20,
      }),
    });
  });

  test('Rejects client-supplied status on creation, payer-plan mismatch (400), and missing references (404)', async () => {
    mockAuthUser('CODER');
    const statusInject = await request(app)
      .post('/api/v1/encounters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: 1,
        providerId: 2,
        payerId: 3,
        planId: 4,
        encounterDate: '2026-10-01',
        placeOfService: '11',
        status: 'VALIDATED',
      });
    expect(statusInject.status).toBe(400);

    mockAuthUser('CODER');
    prisma.patient.findUnique.mockResolvedValueOnce({ id: 1 });
    prisma.provider.findUnique.mockResolvedValueOnce({ id: 2 });
    prisma.payer.findUnique.mockResolvedValueOnce({ id: 3 });
    prisma.insurancePlan.findUnique.mockResolvedValueOnce({ id: 4, payerId: 99 });

    const mismatch = await request(app)
      .post('/api/v1/encounters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: 1,
        providerId: 2,
        payerId: 3,
        planId: 4,
        encounterDate: '2026-10-01',
        placeOfService: '11',
      });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe('PAYER_PLAN_MISMATCH');

    mockAuthUser('CODER');
    prisma.patient.findUnique.mockResolvedValueOnce(null);
    prisma.provider.findUnique.mockResolvedValueOnce({ id: 2 });
    prisma.payer.findUnique.mockResolvedValueOnce({ id: 3 });
    prisma.insurancePlan.findUnique.mockResolvedValueOnce({ id: 4, payerId: 3 });

    const missingPatient = await request(app)
      .post('/api/v1/encounters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: 999,
        providerId: 2,
        payerId: 3,
        planId: 4,
        encounterDate: '2026-10-01',
        placeOfService: '11',
      });
    expect(missingPatient.status).toBe(404);
    expect(missingPatient.body.error.code).toBe('PATIENT_NOT_FOUND');
  });

  test('Enforces valid lifecycle transitions and rejects skipping steps (OPEN -> CLAIM_SUBMITTED)', async () => {
    mockAuthUser('CODER');
    prisma.encounter.findUnique.mockResolvedValueOnce({
      id: 10,
      payerId: 3,
      planId: 4,
      status: 'OPEN',
    });

    const invalidTransition = await request(app)
      .patch('/api/v1/encounters/10')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CLAIM_SUBMITTED' });
    expect(invalidTransition.status).toBe(400);
    expect(invalidTransition.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    mockAuthUser('CODER');
    prisma.encounter.findUnique.mockResolvedValueOnce({
      id: 10,
      payerId: 3,
      planId: 4,
      status: 'OPEN',
    });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        encounter: {
          update: jest.fn().mockResolvedValueOnce({ id: 10, status: 'CODING_IN_PROGRESS' }),
        },
        auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 2 }) },
      })
    );
    const validTransition = await request(app)
      .patch('/api/v1/encounters/10')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CODING_IN_PROGRESS' });
    expect(validTransition.status).toBe(200);
    expect(validTransition.body.data.encounter.status).toBe('CODING_IN_PROGRESS');
  });

  test('Blocks deletion with 409 when dependent records/claims exist and deletes cleanly when empty', async () => {
    mockAuthUser('ADMIN');
    prisma.encounter.findUnique.mockResolvedValueOnce({ id: 10, status: 'OPEN' });
    prisma.medicalRecord.count.mockResolvedValueOnce(1);
    prisma.validationResult.count.mockResolvedValueOnce(0);
    prisma.denialRisk.count.mockResolvedValueOnce(0);
    prisma.report.count.mockResolvedValueOnce(0);
    prisma.claim.count.mockResolvedValueOnce(0);

    const delBlocked = await request(app)
      .delete('/api/v1/encounters/10')
      .set('Authorization', `Bearer ${token}`);
    expect(delBlocked.status).toBe(409);
    expect(delBlocked.body.error.code).toBe('DEPENDENT_RECORDS_EXIST');

    mockAuthUser('ADMIN');
    prisma.encounter.findUnique.mockResolvedValueOnce({ id: 10, status: 'OPEN' });
    prisma.medicalRecord.count.mockResolvedValueOnce(0);
    prisma.validationResult.count.mockResolvedValueOnce(0);
    prisma.denialRisk.count.mockResolvedValueOnce(0);
    prisma.report.count.mockResolvedValueOnce(0);
    prisma.claim.count.mockResolvedValueOnce(0);
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        encounter: { delete: jest.fn().mockResolvedValueOnce({ id: 10 }) },
        auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 3 }) },
      })
    );

    const delOk = await request(app)
      .delete('/api/v1/encounters/10')
      .set('Authorization', `Bearer ${token}`);
    expect(delOk.status).toBe(200);
    expect(delOk.body.data.deleted).toBe(true);
  });

  test('Lists encounters with filters and rejects invalid date range', async () => {
    mockAuthUser('CODER');
    prisma.encounter.findMany.mockResolvedValueOnce([{ id: 1, status: 'OPEN' }]);
    prisma.encounter.count.mockResolvedValueOnce(1);

    const listRes = await request(app)
      .get('/api/v1/encounters?status=OPEN&page=1&limit=10')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.meta.total).toBe(1);

    mockAuthUser('CODER');
    const badRange = await request(app)
      .get('/api/v1/encounters?startDate=2026-12-01&endDate=2026-11-01')
      .set('Authorization', `Bearer ${token}`);
    expect(badRange.status).toBe(400);
  });
});
