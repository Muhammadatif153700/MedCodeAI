process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long-12345';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  },
  checkDatabaseHealth: jest.fn(),
  disconnectPrisma: jest.fn(),
}));

const app = require('../src/app');
const { prisma } = require('../src/config/prisma');

function signToken(sub = '4', tv = 0) {
  return jwt.sign({ tv }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(sub),
    expiresIn: '1h',
    issuer: 'medcodeai-api',
    audience: 'medcodeai-client',
  });
}

function mockAuthUser(overrides = {}) {
  prisma.user.findUnique.mockResolvedValueOnce({
    id: 4,
    name: 'Coder One',
    email: 'coder1@medcodeai.local',
    roleId: 3,
    isActive: true,
    accountStatus: 'APPROVED',
    tokenVersion: 0,
    createdAt: new Date('2026-11-26T00:00:00Z'),
    role: { id: 3, name: 'CODER' },
    ...overrides,
  });
}

describe('Self-Service User Profile Management (Phase 8 / KAN-16)', () => {
  const token = signToken('4');

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Requires authentication (401) and retrieves own profile using req.user.id', async () => {
    expect((await request(app).get('/api/v1/profile')).status).toBe(401);

    mockAuthUser();
    mockAuthUser();
    const res = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(4);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  test('Updates allowed profile fields (name, email), rejects privilege fields, and handles duplicate email', async () => {
    mockAuthUser();
    const massAssign = await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hacker', roleId: 1, accountStatus: 'APPROVED', isActive: false });
    expect(massAssign.status).toBe(400);
    expect(massAssign.body.error.code).toBe('VALIDATION_ERROR');

    mockAuthUser();
    mockAuthUser();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 9, email: 'taken@medcodeai.local' });
    const dupRes = await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'TAKEN@medcodeai.local' });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('EMAIL_ALREADY_IN_USE');

    mockAuthUser();
    mockAuthUser();
    prisma.user.findUnique.mockResolvedValueOnce(null);
    const txAuditCreate = jest.fn().mockResolvedValueOnce({ id: 1 });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          update: jest.fn().mockResolvedValueOnce({
            id: 4,
            name: 'Updated Name',
            email: 'new.email@medcodeai.local',
            roleId: 3,
            isActive: true,
            accountStatus: 'APPROVED',
            createdAt: new Date(),
            role: { id: 3, name: 'CODER' },
          }),
        },
        auditLog: { create: txAuditCreate },
      })
    );

    const okRes = await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name', email: 'NEW.EMAIL@medcodeai.local' });

    expect(okRes.status).toBe(200);
    expect(okRes.body.data.user.email).toBe('new.email@medcodeai.local');
    expect(txAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 4,
        action: 'USER_PROFILE_UPDATED',
        entity: 'USER',
        entityId: 4,
      }),
    });
  });

  test('Changes password inside Serializable tx, increments tokenVersion, and logs USER_PASSWORD_CHANGED', async () => {
    const oldHash = await bcrypt.hash('OldPassword#123', 10);

    mockAuthUser();
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          findUnique: jest.fn().mockResolvedValueOnce({ id: 4, passwordHash: oldHash }),
        },
      })
    );
    const wrongCurrent = await request(app)
      .patch('/api/v1/profile/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongPassword!', newPassword: 'NewPassword#123' });
    expect(wrongCurrent.status).toBe(401);
    expect(wrongCurrent.body.error.code).toBe('INVALID_CURRENT_PASSWORD');

    mockAuthUser();
    const longPw = await request(app)
      .patch('/api/v1/profile/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'OldPassword#123', newPassword: 'x'.repeat(73) });
    expect(longPw.status).toBe(400);

    mockAuthUser();
    const txUserUpdate = jest.fn().mockResolvedValueOnce({ id: 4 });
    const txAuditCreate = jest.fn().mockResolvedValueOnce({ id: 2 });
    prisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        user: {
          findUnique: jest.fn().mockResolvedValueOnce({ id: 4, passwordHash: oldHash }),
          update: txUserUpdate,
        },
        auditLog: { create: txAuditCreate },
      })
    );

    const okPw = await request(app)
      .patch('/api/v1/profile/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'OldPassword#123', newPassword: 'NewPassword#123' });

    expect(okPw.status).toBe(200);
    expect(okPw.body.data.passwordChanged).toBe(true);
    const savedData = txUserUpdate.mock.calls[0][0].data;
    expect(savedData.passwordHash).not.toBe('NewPassword#123');
    expect(savedData.tokenVersion).toEqual({ increment: 1 });
    await expect(bcrypt.compare('NewPassword#123', savedData.passwordHash)).resolves.toBe(true);
    expect(txAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 4,
        action: 'USER_PASSWORD_CHANGED',
        entity: 'USER',
        entityId: 4,
      }),
    });
  });

  test('F-02: Password change, disable, and reactivation invalidate old JWTs immediately', async () => {
    // Old token (tv: 0) is rejected after DB tokenVersion incremented to 1
    mockAuthUser({ tokenVersion: 1 });
    const resAfterPw = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`);
    expect(resAfterPw.status).toBe(401);
    expect(resAfterPw.body.error.code).toBe('TOKEN_REVOKED');

    // New token issued with tv: 1 succeeds
    const newToken = signToken('4', 1);
    mockAuthUser({ tokenVersion: 1 });
    mockAuthUser({ tokenVersion: 1 });
    const resNewToken = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${newToken}`);
    expect(resNewToken.status).toBe(200);

    // After disabling user in DB, token is rejected with 403 ACCOUNT_DISABLED
    mockAuthUser({ isActive: false, tokenVersion: 2 });
    const resDisabled = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${newToken}`);
    expect(resDisabled.status).toBe(403);
    expect(resDisabled.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});
