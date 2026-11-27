const request = require('supertest');

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  },
  checkDatabaseHealth: jest.fn().mockResolvedValue(true),
  disconnectPrisma: jest.fn().mockResolvedValue(undefined),
}));

const app = require('../src/app');

describe('Merged KAN-6 Route Mount & Auth Compatibility', () => {
  test('Mounted KAN-6 routes reject unauthenticated requests with 401', async () => {
    const icdRes = await request(app).get('/api/v1/payers/icd10');
    expect(icdRes.status).toBe(401);

    const valRes = await request(app)
      .post('/api/v1/validation/process-encounter')
      .send({ encounterId: 1, rawText: 'Patient presents with hypertension' });
    expect(valRes.status).toBe(401);
  });
});
