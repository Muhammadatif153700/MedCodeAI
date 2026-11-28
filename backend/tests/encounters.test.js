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
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    medicalRecord: { count: jest.fn() },
    codingSuggestion: { count: jest.fn() },
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
const {
  startCoding,
  markValidated,
  markClaimSubmitted,
  closeEncounter,
} = require('../src/modules/encounters');

function signToken(sub = '2') {
  return jwt.sign({ tv: 0 }, process.env.JWT_SECRET, {
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
    tokenVersion: 0,
    role: { id: 2, name: roleName },
  });
}

describe('Encounters Module & Hardened Lifecycle (Phase 7 & 9B / KAN-19, F-01)', () => {
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

  test('Rejects client-supplied status on create, payer-plan mismatch (400), and missing refs (404)', async () => {
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

  test('F-01: Generic PATCH rejects workflow status changes and blocks metadata edits once locked or dependents exist', async () => {
    mockAuthUser('CODER');
    const bypassAttempt = await request(app)
      .patch('/api/v1/encounters/10')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'VALIDATED' });
    expect(bypassAttempt.status).toBe(400);
    expect(bypassAttempt.body.error.code).toBe('VALIDATION_ERROR');

    mockAuthUser('CODER');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        encounter: {
          findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'CODING_IN_PROGRESS' }),
        },
      })
    );
    const lockedRes = await request(app)
      .patch('/api/v1/encounters/10')
      .set('Authorization', `Bearer ${token}`)
      .send({ placeOfService: '21' });
    expect(lockedRes.status).toBe(409);
    expect(lockedRes.body.error.code).toBe('ENCOUNTER_LOCKED');

    mockAuthUser('CODER');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        encounter: {
          findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'OPEN' }),
        },
        medicalRecord: { count: jest.fn().mockResolvedValueOnce(1) },
        validationResult: { count: jest.fn().mockResolvedValueOnce(0) },
        denialRisk: { count: jest.fn().mockResolvedValueOnce(0) },
        report: { count: jest.fn().mockResolvedValueOnce(0) },
        claim: { count: jest.fn().mockResolvedValueOnce(0) },
      })
    );
    const depEditRes = await request(app)
      .patch('/api/v1/encounters/10')
      .set('Authorization', `Bearer ${token}`)
      .send({ placeOfService: '21' });
    expect(depEditRes.status).toBe(409);
    expect(depEditRes.body.error.code).toBe('DEPENDENT_RECORDS_EXIST');
  });

  test('F-01: Internal transition service enforces roles, prerequisites, concurrency, and atomic audit', async () => {
    // Unauthorized role for startCoding
    await expect(
      startCoding(10, { userId: 2, role: 'REVIEWER', ipAddress: '127.0.0.1' })
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    // Missing medical record prerequisite for startCoding
    const txMissingRec = {
      encounter: { findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'OPEN' }) },
      medicalRecord: { count: jest.fn().mockResolvedValueOnce(0) },
    };
    await expect(
      startCoding(10, { userId: 3, role: 'CODER' }, { tx: txMissingRec })
    ).rejects.toMatchObject({ statusCode: 400, code: 'CODING_PREREQUISITE_MISSING' });

    // Failed validation blocks markValidated
    const txFailedVal = {
      encounter: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'CODING_IN_PROGRESS' }),
      },
      validationResult: {
        count: jest
          .fn()
          .mockResolvedValueOnce(2) // totalValidations
          .mockResolvedValueOnce(1), // failedValidations
      },
      codingSuggestion: { count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) },
    };
    await expect(
      markValidated(10, { userId: 2, role: 'BILLING_SPECIALIST' }, { tx: txFailedVal })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_NOT_PASSED' });

    // Unsubmitted DRAFT claim blocks markClaimSubmitted
    const txDraftClaim = {
      encounter: { findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'VALIDATED' }) },
      claim: { count: jest.fn().mockResolvedValueOnce(0) },
    };
    await expect(
      markClaimSubmitted(10, { userId: 2, role: 'BILLING_SPECIALIST' }, { tx: txDraftClaim })
    ).rejects.toMatchObject({ statusCode: 400, code: 'CLAIM_NOT_SUBMITTED' });

    // Concurrent modification detected via conditional updateMany returning count=0
    const txConcurrent = {
      encounter: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'VALIDATED' }),
        updateMany: jest.fn().mockResolvedValueOnce({ count: 0 }),
      },
      claim: { count: jest.fn().mockResolvedValueOnce(1) },
    };
    await expect(
      markClaimSubmitted(10, { userId: 2, role: 'BILLING_SPECIALIST' }, { tx: txConcurrent })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONCURRENT_MODIFICATION' });

    // Successful markValidated with caller tx and atomic audit
    const txOkVal = {
      encounter: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 10, status: 'CODING_IN_PROGRESS' })
          .mockResolvedValueOnce({ id: 10, status: 'VALIDATED' }),
        updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
      },
      validationResult: {
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      },
      codingSuggestion: { count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0) },
      auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 100 }) },
    };
    const validated = await markValidated(
      10,
      { userId: 2, role: 'BILLING_SPECIALIST', ipAddress: '127.0.0.1' },
      { tx: txOkVal }
    );
    expect(validated.status).toBe('VALIDATED');
    expect(txOkVal.auditLog.create).toHaveBeenCalledTimes(1);

    // Unreviewed SUGGESTED coding suggestions block markValidated
    const txUnreviewed = {
      encounter: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'CODING_IN_PROGRESS' }),
      },
      validationResult: {
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      },
      codingSuggestion: {
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1),
      },
    };
    await expect(
      markValidated(10, { userId: 2, role: 'BILLING_SPECIALIST' }, { tx: txUnreviewed })
    ).rejects.toMatchObject({ statusCode: 400, code: 'UNREVIEWED_SUGGESTIONS_EXIST' });

    // closeEncounter blocked if non-terminal claims exist
    const txOpenClaims = {
      encounter: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'CLAIM_SUBMITTED' }),
      },
      claim: { count: jest.fn().mockResolvedValueOnce(1) },
    };
    await expect(
      closeEncounter(10, { userId: 1, role: 'ADMIN' }, { tx: txOpenClaims })
    ).rejects.toMatchObject({ statusCode: 409, code: 'OPEN_CLAIMS_EXIST' });

    // closeEncounter rejects CODING_IN_PROGRESS and VALIDATED mid-workflow closure
    for (const midStatus of ['CODING_IN_PROGRESS', 'VALIDATED']) {
      const txMid = {
        encounter: {
          findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: midStatus }),
        },
      };
      await expect(
        closeEncounter(10, { userId: 1, role: 'ADMIN' }, { tx: txMid })
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_STATUS_TRANSITION' });
    }

    // closeEncounter on OPEN requires ADMIN and 0 dependents
    const txOpenNonAdmin = {
      encounter: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'OPEN' }),
      },
    };
    await expect(
      closeEncounter(10, { userId: 2, role: 'BILLING_SPECIALIST' }, { tx: txOpenNonAdmin })
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    const txOpenHasDeps = {
      encounter: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'OPEN' }),
      },
      medicalRecord: { count: jest.fn().mockResolvedValueOnce(1) },
      validationResult: { count: jest.fn().mockResolvedValueOnce(0) },
      denialRisk: { count: jest.fn().mockResolvedValueOnce(0) },
      report: { count: jest.fn().mockResolvedValueOnce(0) },
      claim: { count: jest.fn().mockResolvedValueOnce(0) },
    };
    await expect(
      closeEncounter(10, { userId: 1, role: 'ADMIN' }, { tx: txOpenHasDeps })
    ).rejects.toMatchObject({ statusCode: 409, code: 'DEPENDENT_RECORDS_EXIST' });

    const txOpenCloseOk = {
      encounter: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 10, status: 'OPEN' })
          .mockResolvedValueOnce({ id: 10, status: 'CLOSED' }),
        updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
      },
      medicalRecord: { count: jest.fn().mockResolvedValueOnce(0) },
      validationResult: { count: jest.fn().mockResolvedValueOnce(0) },
      denialRisk: { count: jest.fn().mockResolvedValueOnce(0) },
      report: { count: jest.fn().mockResolvedValueOnce(0) },
      claim: { count: jest.fn().mockResolvedValueOnce(0) },
      auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 101 }) },
    };
    const closedOpen = await closeEncounter(
      10,
      { userId: 1, role: 'ADMIN', ipAddress: '127.0.0.1' },
      { tx: txOpenCloseOk }
    );
    expect(closedOpen.status).toBe('CLOSED');

    const txClaimCloseOk = {
      encounter: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 10, status: 'CLAIM_SUBMITTED' })
          .mockResolvedValueOnce({ id: 10, status: 'CLOSED' }),
        updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
      },
      claim: { count: jest.fn().mockResolvedValueOnce(0) },
      auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 102 }) },
    };
    const closedClaim = await closeEncounter(
      10,
      { userId: 2, role: 'BILLING_SPECIALIST', ipAddress: '127.0.0.1' },
      { tx: txClaimCloseOk }
    );
    expect(closedClaim.status).toBe('CLOSED');
  });

  test('Blocks deletion with 409 when dependent records/claims exist and deletes cleanly when empty', async () => {
    mockAuthUser('ADMIN');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        encounter: { findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'OPEN' }) },
        medicalRecord: { count: jest.fn().mockResolvedValueOnce(1) },
        validationResult: { count: jest.fn().mockResolvedValueOnce(0) },
        denialRisk: { count: jest.fn().mockResolvedValueOnce(0) },
        report: { count: jest.fn().mockResolvedValueOnce(0) },
        claim: { count: jest.fn().mockResolvedValueOnce(0) },
      })
    );

    const delBlocked = await request(app)
      .delete('/api/v1/encounters/10')
      .set('Authorization', `Bearer ${token}`);
    expect(delBlocked.status).toBe(409);
    expect(delBlocked.body.error.code).toBe('DEPENDENT_RECORDS_EXIST');

    mockAuthUser('ADMIN');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        encounter: {
          findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'OPEN' }),
          delete: jest.fn().mockResolvedValueOnce({ id: 10 }),
        },
        medicalRecord: { count: jest.fn().mockResolvedValueOnce(0) },
        validationResult: { count: jest.fn().mockResolvedValueOnce(0) },
        denialRisk: { count: jest.fn().mockResolvedValueOnce(0) },
        report: { count: jest.fn().mockResolvedValueOnce(0) },
        claim: { count: jest.fn().mockResolvedValueOnce(0) },
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
