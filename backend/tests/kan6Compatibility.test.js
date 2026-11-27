process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'kan6-compatibility-test-jwt-secret-32chars';
process.env.ML_API_URL = 'http://localhost:8000/predict';

const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

const mockPrisma = {
  user: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() },
  icd10Code: { findMany: jest.fn(), create: jest.fn() },
  cptCode: { findMany: jest.fn(), create: jest.fn() },
  modifier: { findMany: jest.fn() },
  payerRule: { findMany: jest.fn(), create: jest.fn() },
  claimEditRule: { findMany: jest.fn() },
  rateReference: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
  encounter: { findUnique: jest.fn(), updateMany: jest.fn() },
  validationResult: { create: jest.fn(), count: jest.fn() },
  denialRisk: { create: jest.fn() },
  codingSuggestion: { count: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
};

jest.mock('../src/config/prisma', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn().mockResolvedValue(true),
  disconnectPrisma: jest.fn().mockResolvedValue(undefined),
}));

const { validateEnv } = require('../src/config/env');
const { signAccessToken } = require('../src/modules/auth/jwt.util');
const app = require('../src/app');

function mockUserAuth(roleName, id = 1) {
  mockPrisma.user.findUnique.mockResolvedValueOnce({
    id,
    name: `Test ${roleName}`,
    email: `${roleName.toLowerCase()}@medcodeai.test`,
    isActive: true,
    accountStatus: 'APPROVED',
    tokenVersion: 0,
    role: { id: 1, name: roleName },
  });
  return signAccessToken({ userId: id, tokenVersion: 0 });
}

describe('KAN-6 Compatibility & Integration Repairs (Mocked)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ML_API_URL = '';
  });

  test('Express app starts, /health and /health/db return 200, and ML_API_URL is optional & validated', () => {
    expect(() => validateEnv({})).not.toThrow();
    expect(() => validateEnv({ ML_API_URL: 'http://localhost:8000/predict' })).not.toThrow();
    expect(() => validateEnv({ ML_API_URL: 'not-a-url' })).toThrow(/ML_API_URL/);

    return Promise.all([
      request(app).get('/api/v1/health').expect(200),
      request(app).get('/api/v1/health/db').expect(200),
    ]);
  });

  test('KAN-6 routes enforce authentication and variadic RBAC permissions', async () => {
    expect((await request(app).get('/api/v1/payers/icd10')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/v1/payers/icd10')
          .set('Authorization', 'Bearer invalid.jwt.token')
      ).status
    ).toBe(401);

    // CODER allowed on GET /payers/icd10, forbidden on POST /payers/icd10 (ADMIN only)
    const coderToken = mockUserAuth('CODER', 2);
    mockPrisma.icd10Code.findMany.mockResolvedValueOnce([{ code: 'I10', description: 'HTN' }]);
    const coderGet = await request(app)
      .get('/api/v1/payers/icd10')
      .set('Authorization', `Bearer ${coderToken}`);
    expect(coderGet.status).toBe(200);

    const coderPostToken = mockUserAuth('CODER', 2);
    const coderPost = await request(app)
      .post('/api/v1/payers/icd10')
      .set('Authorization', `Bearer ${coderPostToken}`)
      .send({ code: 'E11', description: 'T2DM' });
    expect(coderPost.status).toBe(403);

    // REVIEWER forbidden on GET /payers/rates
    const revToken = mockUserAuth('REVIEWER', 3);
    const revRates = await request(app)
      .get('/api/v1/payers/rates')
      .set('Authorization', `Bearer ${revToken}`);
    expect(revRates.status).toBe(403);

    // BILLING_SPECIALIST allowed on GET /payers/rates
    const billingToken = mockUserAuth('BILLING_SPECIALIST', 4);
    mockPrisma.rateReference.findMany.mockResolvedValueOnce([]);
    const billRates = await request(app)
      .get('/api/v1/payers/rates')
      .set('Authorization', `Bearer ${billingToken}`);
    expect(billRates.status).toBe(200);
  });

  test('Payers mutations validate input, persist atomic AuditService logs, and roll back on audit failure', async () => {
    const adminToken = mockUserAuth('ADMIN', 1);
    const badReq = await request(app)
      .post('/api/v1/payers/icd10')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '' });
    expect(badReq.status).toBe(400);

    // createIcd10Code logs CODE_LIBRARY_UPDATED with entityId: null
    const adminToken2 = mockUserAuth('ADMIN', 1);
    const auditCreateMock = jest.fn().mockResolvedValueOnce({ id: 10 });
    mockPrisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        icd10Code: { create: jest.fn().mockResolvedValueOnce({ code: 'J06', description: 'URI' }) },
        auditLog: { create: auditCreateMock },
      })
    );
    const okIcd = await request(app)
      .post('/api/v1/payers/icd10')
      .set('Authorization', `Bearer ${adminToken2}`)
      .send({ code: 'J06', description: 'URI' });
    expect(okIcd.status).toBe(201);
    expect(auditCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 1,
          action: 'CODE_LIBRARY_UPDATED',
          entity: 'CODE_LIBRARY',
          entityId: null,
        }),
      })
    );

    // Transaction rollback when audit fails on createPayerRule
    const adminToken3 = mockUserAuth('ADMIN', 1);
    mockPrisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        payerRule: { create: jest.fn().mockResolvedValueOnce({ id: 55 }) },
        auditLog: { create: jest.fn().mockRejectedValueOnce(new Error('Audit write failed')) },
      })
    );
    const failRule = await request(app)
      .post('/api/v1/payers/rules')
      .set('Authorization', `Bearer ${adminToken3}`)
      .send({
        payerId: 1,
        ruleType: 'PRIOR_AUTH',
        ruleJson: { required: true },
        effectiveDate: '2026-01-01',
      });
    expect(failRule.status).toBe(500);
    expect(failRule.body.error.code).toBe('AUDIT_LOG_FAILED');
  });

  test('Validation /process-encounter handles missing encounter, unconfigured/failed ML service, invalid ML payload, failed validation, incomplete coding, and lifecycle transition', async () => {
    // 404 missing encounter
    const coderToken = mockUserAuth('CODER', 2);
    mockPrisma.encounter.findUnique.mockResolvedValueOnce(null);
    const missingEnc = await request(app)
      .post('/api/v1/validation/process-encounter')
      .set('Authorization', `Bearer ${coderToken}`)
      .send({ encounterId: 999, rawText: 'Patient visit clinical text' });
    expect(missingEnc.status).toBe(404);

    // 503 when ML service fails / is unreachable
    const coderToken2 = mockUserAuth('CODER', 2);
    mockPrisma.encounter.findUnique.mockResolvedValueOnce({
      id: 10,
      payerId: 1,
      status: 'CODING_IN_PROGRESS',
    });
    mockPrisma.codingSuggestion.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    mockPrisma.validationResult.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    axios.post.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const unconfMl = await request(app)
      .post('/api/v1/validation/process-encounter')
      .set('Authorization', `Bearer ${coderToken2}`)
      .send({ encounterId: 10, rawText: 'Patient visit clinical text' });
    expect(unconfMl.status).toBe(503);
    expect(unconfMl.body.error.code).toBe('ML_SERVICE_FAILED');

    // 502 when ML returns invalid payload
    const validationService = require('../src/modules/validation/validation.service');
    {
      const coderToken3 = mockUserAuth('CODER', 2);
      mockPrisma.encounter.findUnique.mockResolvedValueOnce({
        id: 10,
        payerId: 1,
        status: 'CODING_IN_PROGRESS',
      });
      mockPrisma.codingSuggestion.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      mockPrisma.validationResult.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      axios.post.mockResolvedValueOnce({ data: { unexpected: true } });
      const badMlRes = await request(app)
        .post('/api/v1/validation/process-encounter')
        .set('Authorization', `Bearer ${coderToken3}`)
        .send({ encounterId: 10, rawText: 'Patient visit clinical text' });
      expect(badMlRes.status).toBe(502);

      // Validation FAILED (claim edit conflict) -> lifecycleUpdated: false
      const coderToken4 = mockUserAuth('CODER', 2);
      mockPrisma.encounter.findUnique.mockResolvedValueOnce({
        id: 10,
        payerId: 1,
        placeOfService: '11',
        status: 'CODING_IN_PROGRESS',
      });
      mockPrisma.codingSuggestion.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      mockPrisma.validationResult.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      axios.post.mockResolvedValueOnce({
        data: { cpt_codes: [{ code: '99213' }], icd10_codes: [{ code: 'I10' }] },
      });
      mockPrisma.$transaction.mockImplementationOnce(async (fn) =>
        fn({
          encounter: {
            findUnique: jest.fn().mockResolvedValue({
              id: 10,
              payerId: 1,
              placeOfService: '11',
              status: 'CODING_IN_PROGRESS',
              plan: { authRequired: false },
            }),
          },
          codingSuggestion: { count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) },
          claimEditRule: {
            findMany: jest.fn().mockResolvedValueOnce([{ codeA: '99213', action: 'DENY' }]),
          },
          validationResult: {
            create: jest.fn().mockResolvedValue({}),
            count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0),
          },
          denialRisk: { create: jest.fn().mockResolvedValue({}) },
          rateReference: { findFirst: jest.fn().mockResolvedValueOnce(null) },
          auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 20 }) },
        })
      );
      const failedValRes = await request(app)
        .post('/api/v1/validation/process-encounter')
        .set('Authorization', `Bearer ${coderToken4}`)
        .send({ encounterId: 10, rawText: 'Patient visit clinical text' });
      expect(failedValRes.status).toBe(200);
      expect(failedValRes.body.data.validation.overallStatus).toBe('FAILED');
      expect(failedValRes.body.data.lifecycleUpdated).toBe(false);

      // Passing ML validation + unreviewed SUGGESTED suggestions -> lifecycleUpdated: false
      const coderToken5 = mockUserAuth('CODER', 2);
      mockPrisma.encounter.findUnique.mockResolvedValueOnce({
        id: 10,
        payerId: 1,
        placeOfService: '11',
        status: 'CODING_IN_PROGRESS',
      });
      mockPrisma.codingSuggestion.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
      mockPrisma.validationResult.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      axios.post.mockResolvedValueOnce({
        data: { cpt_codes: [{ code: '99213' }], icd10_codes: [{ code: 'I10' }] },
      });
      mockPrisma.$transaction.mockImplementationOnce(async (fn) =>
        fn({
          encounter: {
            findUnique: jest.fn().mockResolvedValue({
              id: 10,
              payerId: 1,
              placeOfService: '11',
              status: 'CODING_IN_PROGRESS',
              plan: { authRequired: false },
            }),
          },
          claimEditRule: { findMany: jest.fn().mockResolvedValueOnce([]) },
          validationResult: {
            create: jest.fn().mockResolvedValue({}),
            count: jest
              .fn()
              .mockResolvedValueOnce(0)
              .mockResolvedValueOnce(0)
              .mockResolvedValueOnce(1)
              .mockResolvedValueOnce(0),
          },
          denialRisk: { create: jest.fn().mockResolvedValue({}) },
          rateReference: { findFirst: jest.fn().mockResolvedValueOnce(null) },
          codingSuggestion: {
            count: jest
              .fn()
              .mockResolvedValueOnce(1)
              .mockResolvedValueOnce(1)
              .mockResolvedValueOnce(1)
              .mockResolvedValueOnce(1), // 1 pending!
          },
          auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 21 }) },
        })
      );
      const incompleteCodingRes = await request(app)
        .post('/api/v1/validation/process-encounter')
        .set('Authorization', `Bearer ${coderToken5}`)
        .send({ encounterId: 10, rawText: 'Patient visit clinical text' });
      expect(incompleteCodingRes.status).toBe(200);
      expect(incompleteCodingRes.body.data.lifecycleUpdated).toBe(false);

      // Passing ML validation + all coding reviewed + 0 failed -> transitions to VALIDATED
      const billingToken = mockUserAuth('BILLING_SPECIALIST', 4);
      mockPrisma.encounter.findUnique.mockResolvedValueOnce({
        id: 10,
        payerId: 1,
        placeOfService: '11',
        status: 'CODING_IN_PROGRESS',
      });
      mockPrisma.codingSuggestion.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      mockPrisma.validationResult.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      axios.post.mockResolvedValueOnce({
        data: { cpt_codes: [{ code: '99213' }], icd10_codes: [{ code: 'I10' }] },
      });
      mockPrisma.$transaction.mockImplementationOnce(async (fn) =>
        fn({
          encounter: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce({
                id: 10,
                payerId: 1,
                placeOfService: '11',
                status: 'CODING_IN_PROGRESS',
                plan: { authRequired: false },
              })
              .mockResolvedValueOnce({
                id: 10,
                payerId: 1,
                placeOfService: '11',
                status: 'CODING_IN_PROGRESS',
                plan: { authRequired: false },
              })
              .mockResolvedValueOnce({ id: 10, status: 'CODING_IN_PROGRESS' })
              .mockResolvedValueOnce({ id: 10, status: 'VALIDATED' }),
            updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
          },
          claimEditRule: { findMany: jest.fn().mockResolvedValueOnce([]) },
          validationResult: {
            create: jest.fn().mockResolvedValue({}),
            count: jest
              .fn()
              .mockResolvedValueOnce(0)
              .mockResolvedValueOnce(0)
              .mockResolvedValueOnce(1)
              .mockResolvedValueOnce(0)
              .mockResolvedValueOnce(1)
              .mockResolvedValueOnce(0),
          },
          denialRisk: { create: jest.fn().mockResolvedValue({}) },
          rateReference: { findFirst: jest.fn().mockResolvedValueOnce({ rate: 120, code: '99213' }) },
          codingSuggestion: {
            count: jest
              .fn()
              .mockResolvedValueOnce(1)
              .mockResolvedValueOnce(0)
              .mockResolvedValueOnce(1)
              .mockResolvedValueOnce(0)
              .mockResolvedValueOnce(1)
              .mockResolvedValueOnce(0),
          },
          auditLog: { create: jest.fn().mockResolvedValue({ id: 22 }) },
        })
      );
      const okLifecycleRes = await request(app)
        .post('/api/v1/validation/process-encounter')
        .set('Authorization', `Bearer ${billingToken}`)
        .send({ encounterId: 10, rawText: 'Patient visit clinical text' });
      expect(okLifecycleRes.status).toBe(200);
      expect(okLifecycleRes.body.data.encounterStatus).toBe('VALIDATED');
      expect(okLifecycleRes.body.data.lifecycleUpdated).toBe(true);
      expect(validationService).toBeDefined();
    }
  });
});
