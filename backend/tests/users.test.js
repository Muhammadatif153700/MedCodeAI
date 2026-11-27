process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long-12345';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    role: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  },
  checkDatabaseHealth: jest.fn(),
  disconnectPrisma: jest.fn(),
}));

const app = require('../src/app');
const { prisma } = require('../src/config/prisma');

function signToken(sub = '1') {
  return jwt.sign({ tv: 0 }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(sub),
    expiresIn: '1h',
    issuer: 'medcodeai-api',
    audience: 'medcodeai-client',
  });
}

function mockAuthUser(id = 1, roleName = 'ADMIN') {
  prisma.user.findUnique.mockResolvedValueOnce({
    id,
    name: 'Admin User',
    email: 'admin@medcodeai.local',
    roleId: 1,
    isActive: true,
    accountStatus: 'APPROVED',
    tokenVersion: 0,
    role: { id: 1, name: roleName },
  });
}

describe('Administrator User & Role Management (Phase 8 / KAN-15)', () => {
  const adminToken = signToken('1');

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Requires authentication (401) and rejects non-ADMIN roles (403)', async () => {
    expect((await request(app).get('/api/v1/users')).status).toBe(401);
    expect((await request(app).get('/api/v1/roles')).status).toBe(401);

    for (const role of ['CODER', 'BILLING_SPECIALIST', 'REVIEWER']) {
      mockAuthUser(2, role);
      expect(
        (await request(app).get('/api/v1/users').set('Authorization', `Bearer ${adminToken}`)).status
      ).toBe(403);
    }
  });

  test('Lists users with pagination, search, filters, and excludes passwordHash', async () => {
    mockAuthUser(1, 'ADMIN');
    prisma.user.findMany.mockResolvedValueOnce([
      {
        id: 4,
        name: 'Coder One',
        email: 'coder1@medcodeai.local',
        roleId: 3,
        isActive: true,
        accountStatus: 'APPROVED',
        createdAt: new Date('2026-11-26T00:00:00Z'),
        role: { id: 3, name: 'CODER' },
      },
    ]);
    prisma.user.count.mockResolvedValueOnce(1);

    const res = await request(app)
      .get('/api/v1/users?page=1&limit=10&search=Coder&role=CODER&accountStatus=APPROVED&isActive=true')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].passwordHash).toBeUndefined();
    expect(res.body.data[0].role).toBe('CODER');
    expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
  });

  test('GET /api/v1/users/pending resolves static route before /:id', async () => {
    mockAuthUser(1, 'ADMIN');
    prisma.user.findMany.mockResolvedValueOnce([
      {
        id: 8,
        name: 'Pending User',
        email: 'pending@medcodeai.local',
        roleId: null,
        isActive: true,
        accountStatus: 'PENDING',
        createdAt: new Date('2026-11-26T00:00:00Z'),
        role: null,
      },
    ]);
    prisma.user.count.mockResolvedValueOnce(1);

    const res = await request(app)
      .get('/api/v1/users/pending')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].accountStatus).toBe('PENDING');
  });

  test('GET /api/v1/roles returns the 4 business roles', async () => {
    mockAuthUser(1, 'ADMIN');
    prisma.role.findMany.mockResolvedValueOnce([
      { id: 1, name: 'ADMIN' },
      { id: 2, name: 'BILLING_SPECIALIST' },
      { id: 3, name: 'CODER' },
      { id: 4, name: 'REVIEWER' },
    ]);

    const res = await request(app)
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
  });

  test('Approves PENDING user with valid role atomically and writes dual audit logs', async () => {
    mockAuthUser(1, 'ADMIN');

    const txAuditCreate = jest.fn().mockResolvedValue({ id: 1 });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          findUnique: jest.fn().mockResolvedValueOnce({
            id: 8,
            name: 'Pending User',
            email: 'pending@medcodeai.local',
            roleId: null,
            isActive: true,
            accountStatus: 'PENDING',
            role: null,
          }),
          update: jest.fn().mockResolvedValueOnce({
            id: 8,
            name: 'Pending User',
            email: 'pending@medcodeai.local',
            roleId: 3,
            isActive: true,
            accountStatus: 'APPROVED',
            createdAt: new Date(),
            role: { id: 3, name: 'CODER' },
          }),
        },
        role: { findUnique: jest.fn().mockResolvedValueOnce({ id: 3, name: 'CODER' }) },
        auditLog: { create: txAuditCreate },
      })
    );

    const res = await request(app)
      .patch('/api/v1/users/8/approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'CODER' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.accountStatus).toBe('APPROVED');
    expect(res.body.data.user.role).toBe('CODER');
    expect(txAuditCreate).toHaveBeenCalledTimes(2);
    expect(txAuditCreate.mock.calls[0][0].data.action).toBe('USER_ACCOUNT_APPROVED');
    expect(txAuditCreate.mock.calls[1][0].data.action).toBe('USER_ROLE_ASSIGNED');
  });

  test('Rejects PENDING user and blocks invalid transitions (already APPROVED/REJECTED)', async () => {
    mockAuthUser(1, 'ADMIN');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          findUnique: jest.fn().mockResolvedValueOnce({
            id: 8,
            accountStatus: 'PENDING',
            role: null,
          }),
          update: jest.fn().mockResolvedValueOnce({
            id: 8,
            name: 'Pending User',
            email: 'pending@medcodeai.local',
            roleId: null,
            isActive: true,
            accountStatus: 'REJECTED',
            createdAt: new Date(),
            role: null,
          }),
        },
        auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 1 }) },
      })
    );

    const rejRes = await request(app)
      .patch('/api/v1/users/8/reject')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(rejRes.status).toBe(200);
    expect(rejRes.body.data.user.accountStatus).toBe('REJECTED');

    mockAuthUser(1, 'ADMIN');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          findUnique: jest.fn().mockResolvedValueOnce({
            id: 8,
            accountStatus: 'REJECTED',
            role: null,
          }),
        },
      })
    );
    const reApprove = await request(app)
      .patch('/api/v1/users/8/approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'CODER' });
    expect(reApprove.status).toBe(400);
    expect(reApprove.body.error.code).toBe('INVALID_ACCOUNT_TRANSITION');
  });

  test('Prevents self-disable, self-demotion, and disabling/demoting last active ADMIN', async () => {
    mockAuthUser(1, 'ADMIN');
    const selfDisable = await request(app)
      .patch('/api/v1/users/1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(selfDisable.status).toBe(400);
    expect(selfDisable.body.error.code).toBe('SELF_DISABLE_FORBIDDEN');

    mockAuthUser(1, 'ADMIN');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          findUnique: jest.fn().mockResolvedValueOnce({
            id: 1,
            accountStatus: 'APPROVED',
            isActive: true,
            role: { id: 1, name: 'ADMIN' },
          }),
        },
        role: { findUnique: jest.fn().mockResolvedValueOnce({ id: 3, name: 'CODER' }) },
      })
    );
    const selfDemote = await request(app)
      .patch('/api/v1/users/1/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'CODER' });
    expect(selfDemote.status).toBe(400);
    expect(selfDemote.body.error.code).toBe('SELF_DEMOTION_FORBIDDEN');

    // Last active admin protection when disabling another admin who is the last active one
    mockAuthUser(1, 'ADMIN');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          findUnique: jest.fn().mockResolvedValueOnce({
            id: 99,
            isActive: true,
            accountStatus: 'APPROVED',
            role: { id: 1, name: 'ADMIN' },
          }),
          count: jest.fn().mockResolvedValueOnce(1),
        },
      })
    );
    const lastAdminDisable = await request(app)
      .patch('/api/v1/users/99/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(lastAdminDisable.status).toBe(409);
    expect(lastAdminDisable.body.error.code).toBe('LAST_ADMIN_PROTECTION');
  });

  test('Handles concurrent P2034 serialization conflicts safely with 409', async () => {
    mockAuthUser(1, 'ADMIN');
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });

    const res = await request(app)
      .patch('/api/v1/users/2/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
  });

  test('F-02 & F-07: Role assignment and status changes increment tokenVersion and cover 404/last-admin demotion', async () => {
    mockAuthUser(1, 'ADMIN');
    prisma.user.findUnique.mockResolvedValueOnce(null);
    const notFound = await request(app)
      .get('/api/v1/users/9999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(notFound.status).toBe(404);

    // Last-admin demotion blocked
    mockAuthUser(1, 'ADMIN');
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          findUnique: jest.fn().mockResolvedValueOnce({
            id: 99,
            isActive: true,
            accountStatus: 'APPROVED',
            roleId: 1,
            role: { id: 1, name: 'ADMIN' },
          }),
          count: jest.fn().mockResolvedValueOnce(1),
        },
        role: { findUnique: jest.fn().mockResolvedValueOnce({ id: 3, name: 'CODER' }) },
      })
    );
    const lastDemote = await request(app)
      .patch('/api/v1/users/99/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'CODER' });
    expect(lastDemote.status).toBe(409);
    expect(lastDemote.body.error.code).toBe('LAST_ADMIN_PROTECTION');

    // Successful role reassignment increments tokenVersion
    mockAuthUser(1, 'ADMIN');
    const txRoleUpdate = jest.fn().mockResolvedValueOnce({
      id: 4,
      name: 'Coder',
      email: 'c@e.com',
      roleId: 4,
      isActive: true,
      accountStatus: 'APPROVED',
      createdAt: new Date(),
      role: { id: 4, name: 'REVIEWER' },
    });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          findUnique: jest.fn().mockResolvedValueOnce({
            id: 4,
            isActive: true,
            accountStatus: 'APPROVED',
            roleId: 3,
            role: { id: 3, name: 'CODER' },
          }),
          update: txRoleUpdate,
        },
        role: { findUnique: jest.fn().mockResolvedValueOnce({ id: 4, name: 'REVIEWER' }) },
        auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 10 }) },
      })
    );
    const roleOk = await request(app)
      .patch('/api/v1/users/4/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'REVIEWER' });
    expect(roleOk.status).toBe(200);
    expect(txRoleUpdate.mock.calls[0][0].data.tokenVersion).toEqual({ increment: 1 });

    // Reactivating disabled user increments tokenVersion so pre-disable tokens cannot become valid again
    mockAuthUser(1, 'ADMIN');
    const txStatusUpdate = jest.fn().mockResolvedValueOnce({
      id: 4,
      name: 'Coder',
      email: 'c@e.com',
      roleId: 4,
      isActive: true,
      accountStatus: 'APPROVED',
      createdAt: new Date(),
      role: { id: 4, name: 'REVIEWER' },
    });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          findUnique: jest.fn().mockResolvedValueOnce({
            id: 4,
            isActive: false,
            accountStatus: 'APPROVED',
            role: { id: 4, name: 'REVIEWER' },
          }),
          update: txStatusUpdate,
        },
        auditLog: { create: jest.fn().mockResolvedValueOnce({ id: 11 }) },
      })
    );
    const reactivate = await request(app)
      .patch('/api/v1/users/4/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true });
    expect(reactivate.status).toBe(200);
    expect(txStatusUpdate.mock.calls[0][0].data.tokenVersion).toEqual({ increment: 1 });
  });
});
