process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long-12345';

const request = require('supertest');

const mockIcd10FindMany = jest.fn();

jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    PrismaClient: jest.fn(() => ({
      icd10Code: {
        findMany: mockIcd10FindMany,
      },
      $disconnect: jest.fn(),
    })),
  };
});

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    auditLog: { findMany: jest.fn(), count: jest.fn() },
  },
  checkDatabaseHealth: jest.fn().mockResolvedValue(undefined),
  disconnectPrisma: jest.fn(),
}));

const app = require('../src/app');

describe('Combined Router Integration (KAN-4 + KAN-6)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Health and DB health endpoints remain mounted', async () => {
    const healthRes = await request(app).get('/api/v1/health');
    expect(healthRes.status).toBe(200);

    const dbRes = await request(app).get('/api/v1/health/db');
    expect(dbRes.status).toBe(200);
  });

  test('Protected /auth/me and /audit-logs remain guarded (401 without token)', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/audit-logs')).status).toBe(401);
  });

  test('KAN-6 /payers and /validation routers are mounted cleanly', async () => {
    mockIcd10FindMany.mockResolvedValueOnce([
      { code: 'SYN-ICD-001', description: 'Synthetic fixture' },
    ]);

    const payersRes = await request(app).get('/api/v1/payers/icd10');
    expect(payersRes.status).toBe(200);
    expect(payersRes.body.success).toBe(true);
    expect(payersRes.body.data).toHaveLength(1);

    const valRes = await request(app)
      .post('/api/v1/validation/process-encounter')
      .send({});
    expect(valRes.status).toBe(400);
    expect(valRes.body.error.code).toBe('MISSING_FIELDS');
  });
});
