process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long-12345';

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
  checkDatabaseHealth: jest.fn(),
  disconnectPrisma: jest.fn(),
}));

const app = require('../src/app');
const { prisma } = require('../src/config/prisma');
const { createAuthRateLimiter } = require('../src/modules/auth/auth.routes');

describe('Authentication Endpoints — Registration, Login & /me (Phase 6 / KAN-12, KAN-13)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/auth/register', () => {
    test('1, 2, 3, 4, 11 & 12. Registers PENDING user with hashed password, null role, no JWT, and atomic audit log', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const createdUser = {
        id: 10,
        name: 'Jane Coder',
        email: 'jane@example.com',
        roleId: null,
        isActive: true,
        accountStatus: 'PENDING',
        createdAt: new Date('2026-11-26T12:00:00Z'),
        role: null,
      };

      const txUserCreate = jest.fn().mockResolvedValueOnce(createdUser);
      const txAuditCreate = jest.fn().mockResolvedValueOnce({ id: 1 });
      prisma.$transaction.mockImplementationOnce(async (fn) =>
        fn({
          user: { create: txUserCreate },
          auditLog: { create: txAuditCreate },
        })
      );

      const res = await request(app).post('/api/v1/auth/register').send({
        name: '  Jane Coder ',
        email: 'JANE@Example.com',
        password: 'StrongPassword123!',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeUndefined();
      expect(res.body.data.user).toMatchObject({
        id: 10,
        name: 'Jane Coder',
        email: 'jane@example.com',
        roleId: null,
        role: null,
        accountStatus: 'PENDING',
        isActive: true,
      });
      expect(res.body.data.user.passwordHash).toBeUndefined();

      const createArgs = txUserCreate.mock.calls[0][0].data;
      expect(createArgs.passwordHash).not.toBe('StrongPassword123!');
      expect(createArgs.passwordHash.startsWith('$2')).toBe(true);
      expect(createArgs.accountStatus).toBe('PENDING');
      expect(createArgs.roleId).toBeNull();

      expect(txAuditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 10,
          action: 'USER_REGISTERED',
          entity: 'USER',
          entityId: 10,
        }),
      });
    });

    test('5 & 6. Rejects duplicate email and handles concurrent P2002 race condition with 409', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 5, email: 'dup@example.com' });

      const res1 = await request(app).post('/api/v1/auth/register').send({
        name: 'Dup User',
        email: 'dup@example.com',
        password: 'StrongPassword123!',
      });
      expect(res1.status).toBe(409);
      expect(res1.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');

      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });

      const res2 = await request(app).post('/api/v1/auth/register').send({
        name: 'Race User',
        email: 'race@example.com',
        password: 'StrongPassword123!',
      });
      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    test('7 & 8. Rejects invalid email and invalid/oversized (>72 bytes) password', async () => {
      const badEmail = await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: 'not-an-email',
        password: 'StrongPassword123!',
      });
      expect(badEmail.status).toBe(400);
      expect(badEmail.body.error.code).toBe('VALIDATION_ERROR');

      const shortPw = await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'short',
      });
      expect(shortPw.status).toBe(400);

      const longPw = await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'a'.repeat(73),
      });
      expect(longPw.status).toBe(400);
    });

    test('9 & 10. Rejects privilege injection (roleId, role, accountStatus, isActive)', async () => {
      const roleInject = await request(app).post('/api/v1/auth/register').send({
        name: 'Attacker',
        email: 'attacker@example.com',
        password: 'StrongPassword123!',
        roleId: 1,
        role: 'ADMIN',
      });
      expect(roleInject.status).toBe(400);
      expect(roleInject.body.error.code).toBe('VALIDATION_ERROR');

      const statusInject = await request(app).post('/api/v1/auth/register').send({
        name: 'Attacker',
        email: 'attacker@example.com',
        password: 'StrongPassword123!',
        accountStatus: 'APPROVED',
        isActive: true,
      });
      expect(statusInject.status).toBe(400);
      expect(statusInject.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('13. Rolls back registration when required audit logging fails inside transaction', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.$transaction.mockImplementationOnce(async (fn) =>
        fn({
          user: {
            create: jest.fn().mockResolvedValueOnce({ id: 99, name: 'Test', email: 't@e.com' }),
          },
          auditLog: {
            create: jest.fn().mockRejectedValueOnce(new Error('DB write error')),
          },
        })
      );

      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'Rollback User',
        email: 'rollback@example.com',
        password: 'StrongPassword123!',
      });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('AUDIT_LOG_FAILED');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    const makeUser = async (overrides = {}) => ({
      id: 4,
      name: 'Synthetic Coder',
      email: 'coder1.demo@medcodeai.local',
      passwordHash: await bcrypt.hash('ValidPass#123', 10),
      roleId: 3,
      isActive: true,
      accountStatus: 'APPROVED',
      createdAt: new Date('2026-11-26T10:00:00Z'),
      role: { id: 3, name: 'CODER' },
      ...overrides,
    });

    test('14, 21, 22 & 23. Logs in approved user, issues HS256 JWT, excludes passwordHash, and logs USER_LOGIN_SUCCESS', async () => {
      const user = await makeUser();
      prisma.user.findUnique.mockResolvedValueOnce(user);
      prisma.auditLog.create.mockResolvedValueOnce({ id: 201 });

      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'CODER1.DEMO@medcodeai.local',
        password: 'ValidPass#123',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(res.body.data.user.role).toBe('CODER');

      const decoded = jwt.verify(res.body.data.token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'medcodeai-api',
        audience: 'medcodeai-client',
      });
      expect(decoded.sub).toBe('4');
      expect(decoded.exp).toBeDefined();
      expect(decoded.passwordHash).toBeUndefined();

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 4,
          action: 'USER_LOGIN_SUCCESS',
          entity: 'USER',
          entityId: 4,
        }),
      });
    });

    test('15 & 24. Incorrect password logs USER_LOGIN_FAILED and returns generic 401', async () => {
      const user = await makeUser();
      prisma.user.findUnique.mockResolvedValueOnce(user);
      prisma.auditLog.create.mockResolvedValueOnce({ id: 202 });

      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'coder1.demo@medcodeai.local',
        password: 'WrongPassword!',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 4,
          action: 'USER_LOGIN_FAILED',
        }),
      });
    });

    test('16 & 24. Unknown email returns generic 401 without fabricating audit userId', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'unknown@medcodeai.local',
        password: 'SomePassword#123',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    test('17, 18, 19 & 20. Rejects PENDING, REJECTED, disabled, and missing-role accounts', async () => {
      for (const [override, expectedCode] of [
        [{ accountStatus: 'PENDING', roleId: null, role: null }, 'ACCOUNT_PENDING_APPROVAL'],
        [{ accountStatus: 'REJECTED' }, 'ACCOUNT_REJECTED'],
        [{ isActive: false }, 'ACCOUNT_DISABLED'],
        [{ roleId: null, role: null }, 'ROLE_NOT_ASSIGNED'],
      ]) {
        const user = await makeUser(override);
        prisma.user.findUnique.mockResolvedValueOnce(user);

        const res = await request(app).post('/api/v1/auth/login').send({
          email: user.email,
          password: 'ValidPass#123',
        });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe(expectedCode);
      }
    });

    test('25. Authentication rate limiter blocks excessive requests with HTTP 429', async () => {
      const limiterApp = express();
      const { errorHandler } = require('../src/middleware/error.middleware');
      limiterApp.post(
        '/limited-login',
        createAuthRateLimiter({ max: 2, windowMs: 60000, skip: () => false }),
        (_req, res) => res.status(200).json({ ok: true })
      );
      limiterApp.use(errorHandler);

      expect((await request(limiterApp).post('/limited-login')).status).toBe(200);
      expect((await request(limiterApp).post('/limited-login')).status).toBe(200);
      const blocked = await request(limiterApp).post('/limited-login');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('AUTH_RATE_LIMIT_EXCEEDED');
    });
  });

  describe('GET /api/v1/auth/me', () => {
    test('45 & 46. Returns safe req.user when authenticated and 401 when unauthenticated', async () => {
      const unauth = await request(app).get('/api/v1/auth/me');
      expect(unauth.status).toBe(401);
      expect(unauth.body.error.code).toBe('AUTHENTICATION_REQUIRED');

      const token = jwt.sign({}, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        subject: '4',
        expiresIn: '1h',
        issuer: 'medcodeai-api',
        audience: 'medcodeai-client',
      });
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 4,
        name: 'Synthetic Coder',
        email: 'coder1.demo@medcodeai.local',
        roleId: 3,
        isActive: true,
        accountStatus: 'APPROVED',
        role: { id: 3, name: 'CODER' },
      });

      const authRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(authRes.status).toBe(200);
      expect(authRes.body.data.user).toEqual({
        id: 4,
        name: 'Synthetic Coder',
        email: 'coder1.demo@medcodeai.local',
        roleId: 3,
        role: 'CODER',
        accountStatus: 'APPROVED',
      });
      expect(authRes.body.data.user.passwordHash).toBeUndefined();
    });
  });
});
