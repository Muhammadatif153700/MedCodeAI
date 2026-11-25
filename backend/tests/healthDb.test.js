const request = require('supertest');

jest.mock('../src/config/prisma', () => {
  const actual = jest.requireActual('../src/config/prisma');
  return {
    ...actual,
    checkDatabaseHealth: jest.fn(),
  };
});

const app = require('../src/app');
const prismaModule = require('../src/config/prisma');

describe('Database Health Endpoint & Prisma Lifecycle (Phase 2)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('3. GET /api/v1/health/db returns HTTP 200 when database is reachable', async () => {
    prismaModule.checkDatabaseHealth.mockResolvedValueOnce(undefined);

    const res = await request(app).get('/api/v1/health/db');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        database: 'connected',
      },
    });
  });

  test('4 & 5. GET /api/v1/health/db returns HTTP 503 without exposing sensitive DB errors', async () => {
    prismaModule.checkDatabaseHealth.mockRejectedValueOnce(
      new Error(
        'FATAL: password authentication failed for host ep-secret-123.neon.tech postgres://admin:secret@host/db'
      )
    );

    const res = await request(app).get('/api/v1/health/db');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is currently unavailable',
      },
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('neon.tech');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('password');
  });

  test('6. Existing GET /api/v1/health remains functional independently of DB state', async () => {
    prismaModule.checkDatabaseHealth.mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        service: 'MedCodeAI API',
        status: 'ok',
      },
    });
  });

  test('7. Prisma client singleton and disconnect lifecycle work safely', async () => {
    const firstImport = require('../src/config/prisma');
    const secondImport = require('../src/config/prisma');
    expect(firstImport.prisma).toBe(secondImport.prisma);

    const disconnectSpy = jest
      .spyOn(firstImport.prisma, '$disconnect')
      .mockResolvedValueOnce(undefined);

    await firstImport.disconnectPrisma();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    disconnectSpy.mockRejectedValueOnce(new Error('Already disconnected'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(firstImport.disconnectPrisma()).resolves.toBeUndefined();
    errSpy.mockRestore();
  });
});
