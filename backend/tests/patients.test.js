process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long-12345';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    patient: {
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
  return jwt.sign({}, process.env.JWT_SECRET, {
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

describe('Patients Module (Phase 7 / KAN-17)', () => {
  const token = signToken('3');

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Requires authentication (401) and rejects REVIEWER role (403)', async () => {
    expect((await request(app).get('/api/v1/patients')).status).toBe(401);

    mockAuthUser('REVIEWER');
    const forbidden = await request(app)
      .get('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`);
    expect(forbidden.status).toBe(403);
  });

  test('Creates patient with valid synthetic data and writes PATIENT_CREATED audit log atomically', async () => {
    mockAuthUser('BILLING_SPECIALIST');
    const created = {
      id: 11,
      name: 'Synthetic Patient',
      dob: new Date('1990-05-10T00:00:00.000Z'),
      gender: 'Female',
      memberId: 'SYN-MEM-0001',
    };
    const txPatientCreate = jest.fn().mockResolvedValueOnce(created);
    const txAuditCreate = jest.fn().mockResolvedValueOnce({ id: 1 });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        patient: { create: txPatientCreate },
        auditLog: { create: txAuditCreate },
      })
    );

    const res = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Synthetic Patient',
        dob: '1990-05-10',
        gender: 'Female',
        memberId: 'SYN-MEM-0001',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.patient.memberId).toBe('SYN-MEM-0001');
    expect(txAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 3,
        action: 'PATIENT_CREATED',
        entity: 'PATIENT',
        entityId: 11,
      }),
    });
  });

  test('Rejects future date of birth, unexpected fields, and invalid IDs', async () => {
    mockAuthUser('CODER');
    const futureDob = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Future Patient',
        dob: '2099-01-01',
        gender: 'Male',
        memberId: 'SYN-MEM-9999',
      });
    expect(futureDob.status).toBe(400);
    expect(futureDob.body.error.code).toBe('VALIDATION_ERROR');

    mockAuthUser('CODER');
    const extraField = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test',
        dob: '1990-01-01',
        gender: 'Male',
        memberId: 'SYN-1',
        extra: 'blocked',
      });
    expect(extraField.status).toBe(400);

    mockAuthUser('CODER');
    const badId = await request(app)
      .get('/api/v1/patients/abc')
      .set('Authorization', `Bearer ${token}`);
    expect(badId.status).toBe(400);
  });

  test('Lists patients with pagination/search and returns 404 for nonexistent patient', async () => {
    mockAuthUser('ADMIN');
    prisma.patient.findMany.mockResolvedValueOnce([
      { id: 1, name: 'Synthetic Patient 1', dob: '1980-01-01', gender: 'Male', memberId: 'SYN-1' },
    ]);
    prisma.patient.count.mockResolvedValueOnce(1);

    const listRes = await request(app)
      .get('/api/v1/patients?page=1&limit=10&search=Synthetic')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });

    mockAuthUser('ADMIN');
    prisma.patient.findUnique.mockResolvedValueOnce(null);
    const notFound = await request(app)
      .get('/api/v1/patients/9999')
      .set('Authorization', `Bearer ${token}`);
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('PATIENT_NOT_FOUND');
  });

  test('Updates patient and blocks deletion with 409 when dependent encounters exist', async () => {
    mockAuthUser('CODER');
    prisma.patient.findUnique.mockResolvedValueOnce({ id: 1, name: 'Old' });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        patient: { update: jest.fn().mockResolvedValueOnce({ id: 1, name: 'Updated' }) },
        auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 2 }) },
      })
    );
    const updRes = await request(app)
      .patch('/api/v1/patients/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated' });
    expect(updRes.status).toBe(200);
    expect(updRes.body.data.patient.name).toBe('Updated');

    mockAuthUser('ADMIN');
    prisma.patient.findUnique.mockResolvedValueOnce({ id: 1, name: 'Updated' });
    prisma.encounter.count.mockResolvedValueOnce(2);
    const delBlocked = await request(app)
      .delete('/api/v1/patients/1')
      .set('Authorization', `Bearer ${token}`);
    expect(delBlocked.status).toBe(409);
    expect(delBlocked.body.error.code).toBe('DEPENDENT_RECORDS_EXIST');
  });

  test('Propagates transaction rollback when audit write fails', async () => {
    mockAuthUser('CODER');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        patient: { create: jest.fn().mockResolvedValueOnce({ id: 50 }) },
        auditLog: { create: jest.fn().mockRejectedValueOnce(new Error('DB failure')) },
      })
    );

    const res = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Tx Fail',
        dob: '1991-01-01',
        gender: 'Female',
        memberId: 'SYN-50',
      });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('AUDIT_LOG_FAILED');
  });
});
