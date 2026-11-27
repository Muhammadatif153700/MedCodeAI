process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long-12345';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    provider: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    encounter: { count: jest.fn() },
    auditLog: { create: jest.fn() },
  },
  checkDatabaseHealth: jest.fn(),
  disconnectPrisma: jest.fn(),
}));

const app = require('../src/app');
const { prisma } = require('../src/config/prisma');

function signToken(sub = '3') {
  return jwt.sign({ tv: 0 }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(sub),
    expiresIn: '1h',
    issuer: 'medcodeai-api',
    audience: 'medcodeai-client',
  });
}

function mockAuthUser(roleName = 'CODER') {
  prisma.user.findUnique.mockResolvedValueOnce({
    id: 3,
    name: 'Test User',
    email: 'user@medcodeai.local',
    roleId: 3,
    isActive: true,
    accountStatus: 'APPROVED',
    role: { id: 3, name: roleName },
  });
}

describe('Providers Module (Phase 7 / KAN-18)', () => {
  const token = signToken('3');

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Requires authentication (401) and rejects REVIEWER role (403)', async () => {
    expect((await request(app).get('/api/v1/providers')).status).toBe(401);

    mockAuthUser('REVIEWER');
    expect(
      (await request(app).get('/api/v1/providers').set('Authorization', `Bearer ${token}`)).status
    ).toBe(403);
  });

  test('Creates provider with 10-digit string NPI and writes PROVIDER_CREATED audit log', async () => {
    mockAuthUser('ADMIN');
    prisma.provider.findUnique.mockResolvedValueOnce(null);

    const created = {
      id: 7,
      name: 'Dr. Synthetic',
      npi: '0123456789',
      specialty: 'Cardiology',
    };
    const txAuditCreate = jest.fn().mockResolvedValueOnce({ id: 1 });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        provider: { create: jest.fn().mockResolvedValueOnce(created) },
        auditLog: { create: txAuditCreate },
      })
    );

    const res = await request(app)
      .post('/api/v1/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Dr. Synthetic',
        npi: '0123456789',
        specialty: 'Cardiology',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.provider.npi).toBe('0123456789');
    expect(typeof res.body.data.provider.npi).toBe('string');
    expect(txAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PROVIDER_CREATED',
        entity: 'PROVIDER',
        entityId: 7,
      }),
    });
  });

  test('Rejects invalid NPI format and duplicate NPI (409 DUPLICATE_NPI)', async () => {
    mockAuthUser('CODER');
    const badNpi = await request(app)
      .post('/api/v1/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dr. Bad', npi: '12345', specialty: 'Cardiology' });
    expect(badNpi.status).toBe(400);

    mockAuthUser('CODER');
    prisma.provider.findUnique.mockResolvedValueOnce({ id: 2, npi: '9000000001' });
    const dupRes = await request(app)
      .post('/api/v1/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dr. Dup', npi: '9000000001', specialty: 'Cardiology' });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('DUPLICATE_NPI');
  });

  test('Lists providers, handles 404, and blocks deletion when dependent encounters exist', async () => {
    mockAuthUser('BILLING_SPECIALIST');
    prisma.provider.findMany.mockResolvedValueOnce([
      { id: 1, name: 'Dr. S1', npi: '9000000001', specialty: 'Cardiology' },
    ]);
    prisma.provider.count.mockResolvedValueOnce(1);

    const listRes = await request(app)
      .get('/api/v1/providers?search=Cardio&page=1&limit=10')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.meta.total).toBe(1);

    mockAuthUser('ADMIN');
    prisma.provider.findUnique.mockResolvedValueOnce(null);
    expect(
      (await request(app).get('/api/v1/providers/999').set('Authorization', `Bearer ${token}`)).status
    ).toBe(404);

    mockAuthUser('ADMIN');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        provider: { findUnique: jest.fn().mockResolvedValueOnce({ id: 1, npi: '9000000001' }) },
        encounter: { count: jest.fn().mockResolvedValueOnce(3) },
      })
    );
    const delBlocked = await request(app)
      .delete('/api/v1/providers/1')
      .set('Authorization', `Bearer ${token}`);
    expect(delBlocked.status).toBe(409);
    expect(delBlocked.body.error.code).toBe('DEPENDENT_RECORDS_EXIST');
  });

  test('Updates provider, rejects empty update & duplicate NPI on update, and deletes clean provider', async () => {
    mockAuthUser('ADMIN');
    const emptyUpd = await request(app)
      .patch('/api/v1/providers/1')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(emptyUpd.status).toBe(400);

    mockAuthUser('ADMIN');
    prisma.provider.findUnique
      .mockResolvedValueOnce({ id: 1, npi: '9000000001' })
      .mockResolvedValueOnce({ id: 2, npi: '9000000002' });
    const dupUpd = await request(app)
      .patch('/api/v1/providers/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ npi: '9000000002' });
    expect(dupUpd.status).toBe(409);
    expect(dupUpd.body.error.code).toBe('DUPLICATE_NPI');

    mockAuthUser('ADMIN');
    prisma.provider.findUnique.mockResolvedValueOnce({ id: 1, npi: '9000000001' });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        provider: {
          update: jest.fn().mockResolvedValueOnce({
            id: 1,
            name: 'Dr. Updated',
            npi: '9000000001',
            specialty: 'Neurology',
          }),
        },
        auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 5 }) },
      })
    );
    const okUpd = await request(app)
      .patch('/api/v1/providers/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ specialty: 'Neurology' });
    expect(okUpd.status).toBe(200);
    expect(okUpd.body.data.provider.specialty).toBe('Neurology');

    mockAuthUser('ADMIN');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        provider: {
          findUnique: jest.fn().mockResolvedValueOnce({ id: 5, npi: '9000000005' }),
          delete: jest.fn().mockResolvedValueOnce({ id: 5 }),
        },
        encounter: { count: jest.fn().mockResolvedValueOnce(0) },
        auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 6 }) },
      })
    );
    const delOk = await request(app)
      .delete('/api/v1/providers/5')
      .set('Authorization', `Bearer ${token}`);
    expect(delOk.status).toBe(200);
    expect(delOk.body.data.deleted).toBe(true);
  });
});
