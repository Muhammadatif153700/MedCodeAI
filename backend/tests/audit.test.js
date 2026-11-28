const request = require('supertest');

jest.mock('../src/config/prisma', () => ({
  prisma: {
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
const {
  AuditService,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  sanitizeIpAddress,
} = require('../src/modules/audit');
const { SAFE_ACTOR_SELECT } = require('../src/modules/audit/audit.repository');

describe('Shared Audit Logging Module (Phase 5 / KAN-20)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('1, 2 & 3. Creates a valid audit entry with correct actor ID and action', async () => {
    const createdRow = {
      id: 101,
      userId: 4,
      action: AUDIT_ACTIONS.RECORD_UPLOADED,
      entity: AUDIT_ENTITIES.MEDICAL_RECORD,
      entityId: 22,
      ipAddress: '192.168.1.10',
      timestamp: new Date('2026-11-26T10:00:00Z'),
    };
    prisma.auditLog.create.mockResolvedValueOnce(createdRow);

    const result = await AuditService.log({
      userId: 4,
      action: AUDIT_ACTIONS.RECORD_UPLOADED,
      entity: AUDIT_ENTITIES.MEDICAL_RECORD,
      entityId: 22,
      ipAddress: '::ffff:192.168.1.10',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 4,
        action: 'RECORD_UPLOADED',
        entity: 'MEDICAL_RECORD',
        entityId: 22,
        ipAddress: '192.168.1.10',
      },
    });
    expect(result).toEqual(createdRow);
  });

  test('4. Rejects invalid or unsupported audit action', async () => {
    await expect(
      AuditService.log({
        userId: 1,
        action: 'ARBITRARY_UNLISTED_ACTION',
        entity: AUDIT_ENTITIES.USER,
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_AUDIT_INPUT' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('5. Rejects missing required fields (userId, action, entity)', async () => {
    await expect(
      AuditService.log({ action: AUDIT_ACTIONS.USER_LOGIN_SUCCESS, entity: AUDIT_ENTITIES.USER })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_AUDIT_INPUT' });

    await expect(
      AuditService.log({ userId: 1, entity: AUDIT_ENTITIES.USER })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_AUDIT_INPUT' });
  });

  test('6. Rejects invalid entityId values (negative, zero, string)', async () => {
    await expect(
      AuditService.log({
        userId: 1,
        action: AUDIT_ACTIONS.PATIENT_CREATED,
        entity: AUDIT_ENTITIES.PATIENT,
        entityId: -5,
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_AUDIT_INPUT' });

    await expect(
      AuditService.log({
        userId: 1,
        action: AUDIT_ACTIONS.PATIENT_CREATED,
        entity: AUDIT_ENTITIES.PATIENT,
        entityId: 'not-an-int',
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_AUDIT_INPUT' });
  });

  test('7 & 8. Rejects arbitrary/sensitive metadata keys and sanitizes IP strings', async () => {
    await expect(
      AuditService.log({
        userId: 1,
        action: AUDIT_ACTIONS.USER_LOGIN_SUCCESS,
        entity: AUDIT_ENTITIES.USER,
        password: 'plaintext-secret',
        token: 'jwt-secret-token',
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_AUDIT_INPUT' });

    expect(sanitizeIpAddress('10.0.0.1?token=secret')).toBeNull();
    expect(sanitizeIpAddress('Bearer abc.def.ghi')).toBeNull();
    expect(sanitizeIpAddress('203.0.113.5, 10.0.0.1')).toBe('203.0.113.5');
  });

  test('9. Supports passing a Prisma transaction client (options.tx)', async () => {
    const txClient = {
      auditLog: {
        create: jest.fn().mockResolvedValueOnce({ id: 55 }),
      },
    };

    const result = await AuditService.log(
      {
        userId: 2,
        action: AUDIT_ACTIONS.CLAIM_SUBMITTED,
        entity: AUDIT_ENTITIES.CLAIM,
        entityId: 9,
      },
      { tx: txClient }
    );

    expect(txClient.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 55 });
  });

  test('10. Propagates database errors safely for critical actions without exposing internals', async () => {
    prisma.auditLog.create.mockRejectedValueOnce(
      new Error('postgres://admin:secret@ep-host/medcodeai constraint failure')
    );

    await expect(
      AuditService.log(
        {
          userId: 1,
          action: AUDIT_ACTIONS.USER_ROLE_ASSIGNED,
          entity: AUDIT_ENTITIES.USER,
          entityId: 2,
        },
        { bestEffort: true }
      )
    ).rejects.toMatchObject({
      statusCode: 500,
      code: 'AUDIT_LOG_FAILED',
      message: 'Unable to persist audit log entry',
    });
  });

  test('11, 12, 13 & 14. Retrieves paginated, filtered logs with safe actor fields and deterministic ordering', async () => {
    prisma.auditLog.findMany.mockResolvedValueOnce([{ id: 10, action: 'USER_LOGIN_SUCCESS' }]);
    prisma.auditLog.count.mockResolvedValueOnce(25);

    const result = await AuditService.list({
      page: '2',
      limit: '10',
      userId: '1',
      action: AUDIT_ACTIONS.USER_LOGIN_SUCCESS,
      entity: AUDIT_ENTITIES.USER,
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-11-30T23:59:59Z',
    });

    expect(SAFE_ACTOR_SELECT).not.toHaveProperty('passwordHash');
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        where: expect.objectContaining({
          userId: 1,
          action: 'USER_LOGIN_SUCCESS',
          entity: 'USER',
          timestamp: {
            gte: new Date('2026-11-01T00:00:00Z'),
            lte: new Date('2026-11-30T23:59:59Z'),
          },
        }),
      })
    );
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });

  test('15. Rejects invalid pagination and invalid date ranges', async () => {
    await expect(AuditService.list({ page: 0 })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_AUDIT_QUERY',
    });

    await expect(AuditService.list({ limit: 500 })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_AUDIT_QUERY',
    });

    await expect(
      AuditService.list({
        startDate: '2026-12-01',
        endDate: '2026-11-01',
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_AUDIT_QUERY',
    });
  });

  test('16. Audit retrieval route requires authentication (returns 401 when unauthenticated)', async () => {
    const res = await request(app).get('/api/v1/audit-logs');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  test('17. Allows null userId only for USER_LOGIN_FAILED and rejects null userId for business mutations', async () => {
    prisma.auditLog.create.mockResolvedValueOnce({
      id: 301,
      userId: null,
      action: 'USER_LOGIN_FAILED',
      entity: 'USER',
      entityId: null,
    });

    const loginFail = await AuditService.log({
      userId: null,
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      entity: AUDIT_ENTITIES.USER,
      entityId: null,
    });
    expect(loginFail.userId).toBeNull();

    await expect(
      AuditService.log({
        userId: null,
        action: AUDIT_ACTIONS.PATIENT_CREATED,
        entity: AUDIT_ENTITIES.PATIENT,
        entityId: 1,
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_AUDIT_INPUT' });
  });

  test('18. Audit retrieval safely returns entries with null actors', async () => {
    prisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 301,
        userId: null,
        action: 'USER_LOGIN_FAILED',
        entity: 'USER',
        entityId: null,
        ipAddress: '127.0.0.1',
        timestamp: new Date('2026-11-27T10:00:00Z'),
        user: null,
      },
    ]);
    prisma.auditLog.count.mockResolvedValueOnce(1);

    const result = await AuditService.list({ page: 1, limit: 10 });
    expect(result.items[0].user).toBeNull();
    expect(result.meta.total).toBe(1);
  });
});
