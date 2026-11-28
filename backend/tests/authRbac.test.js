process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long-12345';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
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
const { authenticate } = require('../src/middleware/auth.middleware');
const { authorize } = require('../src/middleware/rbac.middleware');
const { errorHandler } = require('../src/middleware/error.middleware');
const { ROLES } = require('../src/constants/roles');

function signTestToken(sub, options = {}) {
  const { tv = 0, ...jwtOpts } = options;
  return jwt.sign(tv === undefined ? {} : { tv }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(sub),
    expiresIn: '1h',
    issuer: 'medcodeai-api',
    audience: 'medcodeai-client',
    ...jwtOpts,
  });
}

describe('JWT Authentication & RBAC Middleware (Phase 6 / KAN-13, KAN-14)', () => {
  const rbacApp = express();
  rbacApp.get('/coder-only', authenticate, authorize(ROLES.CODER), (req, res) =>
    res.json({ success: true, user: req.user })
  );
  rbacApp.get(
    '/multi-role',
    authenticate,
    authorize(ROLES.CODER, ROLES.BILLING_SPECIALIST),
    (req, res) => res.json({ success: true, user: req.user })
  );
  rbacApp.get('/no-auth-first', authorize(ROLES.ADMIN), (_req, res) =>
    res.json({ success: true })
  );
  rbacApp.use(errorHandler);

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('26 & 27. Rejects missing or malformed Authorization Bearer token with 401', async () => {
    const missing = await request(rbacApp).get('/coder-only');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTHENTICATION_REQUIRED');

    const malformed = await request(rbacApp)
      .get('/coder-only')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(malformed.status).toBe(401);
    expect(malformed.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  test('28, 29, 30 & 31. Rejects invalid signature, expired token, wrong algorithm, and invalid subject', async () => {
    const wrongSig = jwt.sign({}, 'different-secret-minimum-32-characters-12345', {
      algorithm: 'HS256',
      subject: '1',
      issuer: 'medcodeai-api',
      audience: 'medcodeai-client',
    });
    expect(
      (await request(rbacApp).get('/coder-only').set('Authorization', `Bearer ${wrongSig}`)).status
    ).toBe(401);

    const expired = signTestToken('1', { expiresIn: '-10s' });
    const expRes = await request(rbacApp)
      .get('/coder-only')
      .set('Authorization', `Bearer ${expired}`);
    expect(expRes.status).toBe(401);
    expect(expRes.body.error.code).toBe('TOKEN_EXPIRED');

    const wrongAlg = jwt.sign({}, process.env.JWT_SECRET, {
      algorithm: 'HS512',
      subject: '1',
      issuer: 'medcodeai-api',
      audience: 'medcodeai-client',
    });
    expect(
      (await request(rbacApp).get('/coder-only').set('Authorization', `Bearer ${wrongAlg}`)).status
    ).toBe(401);

    const badSub = signTestToken('not-an-integer');
    expect(
      (await request(rbacApp).get('/coder-only').set('Authorization', `Bearer ${badSub}`)).status
    ).toBe(401);

    // Legacy token missing tv claim is rejected
    const missingTv = signTestToken('4', { tv: undefined });
    expect(
      (await request(rbacApp).get('/coder-only').set('Authorization', `Bearer ${missingTv}`)).status
    ).toBe(401);

    // Mismatched tokenVersion is rejected with 401 TOKEN_REVOKED
    const oldToken = signTestToken('4', { tv: 0 });
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 4,
      name: 'Coder',
      email: 'c@e.com',
      roleId: 3,
      isActive: true,
      accountStatus: 'APPROVED',
      tokenVersion: 1,
      role: { id: 3, name: 'CODER' },
    });
    const revokedRes = await request(rbacApp)
      .get('/coder-only')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(revokedRes.status).toBe(401);
    expect(revokedRes.body.error.code).toBe('TOKEN_REVOKED');
  });

  test('32, 33, 34 & 35. Rejects deleted/disabled user, reflects DB role changes, and fails closed on DB error', async () => {
    const token = signTestToken('4');

    prisma.user.findUnique.mockResolvedValueOnce(null);
    expect(
      (await request(rbacApp).get('/coder-only').set('Authorization', `Bearer ${token}`)).status
    ).toBe(401);

    prisma.user.findUnique.mockResolvedValueOnce({
      id: 4,
      name: 'Disabled',
      email: 'd@e.com',
      roleId: 3,
      isActive: false,
      accountStatus: 'APPROVED',
      role: { id: 3, name: 'CODER' },
    });
    const disRes = await request(rbacApp)
      .get('/coder-only')
      .set('Authorization', `Bearer ${token}`);
    expect(disRes.status).toBe(403);
    expect(disRes.body.error.code).toBe('ACCOUNT_DISABLED');

    // Role changed in DB from CODER to REVIEWER -> /coder-only immediately denies
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 4,
      name: 'Changed Role',
      email: 'c@e.com',
      roleId: 4,
      isActive: true,
      accountStatus: 'APPROVED',
      role: { id: 4, name: 'REVIEWER' },
    });
    expect(
      (await request(rbacApp).get('/coder-only').set('Authorization', `Bearer ${token}`)).status
    ).toBe(403);

    // DB failure fails closed (503)
    prisma.user.findUnique.mockRejectedValueOnce(new Error('DB connection lost'));
    const dbFail = await request(rbacApp)
      .get('/coder-only')
      .set('Authorization', `Bearer ${token}`);
    expect(dbFail.status).toBe(503);
    expect(dbFail.body.error.code).toBe('AUTH_VERIFICATION_UNAVAILABLE');
  });

  test('36, 37, 38, 39, 40 & 41. Enforces RBAC roles, multi-role access, unauthenticated rejection, and invalid role guard', async () => {
    const token = signTestToken('4');
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 4,
      name: 'Coder',
      email: 'c@e.com',
      roleId: 3,
      isActive: true,
      accountStatus: 'APPROVED',
      role: { id: 3, name: 'CODER' },
    });

    const okRes = await request(rbacApp)
      .get('/multi-role')
      .set('Authorization', `Bearer ${token}`);
    expect(okRes.status).toBe(200);
    expect(okRes.body.user).toEqual({
      id: 4,
      name: 'Coder',
      email: 'c@e.com',
      roleId: 3,
      role: 'CODER',
      accountStatus: 'APPROVED',
    });

    // No implicit ADMIN bypass on /coder-only
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 1,
      name: 'Admin',
      email: 'a@e.com',
      roleId: 1,
      isActive: true,
      accountStatus: 'APPROVED',
      role: { id: 1, name: 'ADMIN' },
    });
    expect(
      (await request(rbacApp).get('/coder-only').set('Authorization', `Bearer ${token}`)).status
    ).toBe(403);

    expect((await request(rbacApp).get('/no-auth-first')).status).toBe(401);
    expect(() => authorize('INVALID_ROLE')).toThrow(/Invalid role/);
  });

  test('42, 43 & 44. GET /api/v1/audit-logs allows active ADMIN, rejects non-ADMIN and disabled ADMIN', async () => {
    const adminToken = signTestToken('1');
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 1,
      name: 'Admin',
      email: 'admin@medcodeai.local',
      roleId: 1,
      isActive: true,
      accountStatus: 'APPROVED',
      role: { id: 1, name: 'ADMIN' },
    });
    prisma.auditLog.findMany.mockResolvedValueOnce([]);
    prisma.auditLog.count.mockResolvedValueOnce(0);

    const adminRes = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.success).toBe(true);

    for (const roleName of ['CODER', 'REVIEWER', 'BILLING_SPECIALIST']) {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 2,
        name: roleName,
        email: `${roleName.toLowerCase()}@medcodeai.local`,
        roleId: 2,
        isActive: true,
        accountStatus: 'APPROVED',
        role: { id: 2, name: roleName },
      });
      const denied = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(denied.status).toBe(403);
    }

    prisma.user.findUnique.mockResolvedValueOnce({
      id: 1,
      name: 'Disabled Admin',
      email: 'admin@medcodeai.local',
      roleId: 1,
      isActive: false,
      accountStatus: 'APPROVED',
      role: { id: 1, name: 'ADMIN' },
    });
    const disabledAdmin = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(disabledAdmin.status).toBe(403);
    expect(disabledAdmin.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});
