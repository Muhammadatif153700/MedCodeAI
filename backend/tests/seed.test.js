const bcrypt = require('bcryptjs');
const { validateSeedConfig, hashSeedPassword, runSeed } = require('../prisma/seed');

describe('Seed Safety, Hashing, and Repeatability (Phase 4 / KAN-11)', () => {
  const validEnv = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:pass@ep-demo-pooler.ap-southeast-1.aws.neon.tech/medcodeai?sslmode=require',
    CONFIRM_DEV_SEED: 'true',
    SEED_TARGET_BRANCH: 'ali_dev',
    SEED_APPROVED_ENDPOINTS: 'ep-demo',
    SEED_ADMIN_PASSWORD: 'DevAdmin#1234',
    SEED_STAFF_PASSWORD: 'DevStaff#1234',
    SEED_PENDING_PASSWORD: 'DevPending#1234',
  };

  test('Refuses to run when NODE_ENV is production or DATABASE_URL contains production', () => {
    expect(() =>
      validateSeedConfig({ ...validEnv, NODE_ENV: 'production' })
    ).toThrow(/production/i);

    expect(() =>
      validateSeedConfig({
        ...validEnv,
        DATABASE_URL: 'postgresql://u:p@ep-production.neon.tech/medcodeai',
      })
    ).toThrow(/production/i);
  });

  test('Refuses to run without explicit CONFIRM_DEV_SEED and non-production SEED_TARGET_BRANCH', () => {
    expect(() =>
      validateSeedConfig({ ...validEnv, CONFIRM_DEV_SEED: 'false' })
    ).toThrow(/CONFIRM_DEV_SEED/);

    expect(() =>
      validateSeedConfig({ ...validEnv, SEED_TARGET_BRANCH: 'production' })
    ).toThrow(/SEED_TARGET_BRANCH/);
  });

  test('Refuses to run when SEED_APPROVED_ENDPOINTS is missing or does not match DATABASE_URL endpoint', () => {
    expect(() =>
      validateSeedConfig({ ...validEnv, SEED_APPROVED_ENDPOINTS: '' })
    ).toThrow(/SEED_APPROVED_ENDPOINTS/);

    expect(() =>
      validateSeedConfig({ ...validEnv, SEED_APPROVED_ENDPOINTS: 'ep-other-branch' })
    ).toThrow(/unapproved database endpoint/);
  });

  test('Refuses to run when private seed passwords are missing or too short', () => {
    expect(() =>
      validateSeedConfig({ ...validEnv, SEED_ADMIN_PASSWORD: '' })
    ).toThrow(/SEED_ADMIN_PASSWORD/);
  });

  test('Hashes seed passwords with bcryptjs (never stores plaintext)', async () => {
    const hash = await hashSeedPassword('DevStaff#1234');
    expect(hash).not.toBe('DevStaff#1234');
    expect(hash.startsWith('$2')).toBe(true);
    await expect(bcrypt.compare('DevStaff#1234', hash)).resolves.toBe(true);
  });

  test('Executes idempotently inside a transaction without overwriting existing user records', async () => {
    const mockTx = {
      role: { upsert: jest.fn(async ({ create }) => ({ id: 1, ...create })) },
      user: { upsert: jest.fn(async ({ create }) => ({ id: 1, ...create })) },
      patient: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        create: jest.fn(),
      },
      provider: { upsert: jest.fn(async ({ create }) => ({ id: 1, ...create })) },
      payer: { upsert: jest.fn(async ({ create }) => ({ id: 1, ...create })) },
      insurancePlan: { upsert: jest.fn(async ({ create }) => ({ id: 1, payerId: 1, ...create })) },
      encounter: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        create: jest.fn(),
      },
      icd10Code: { createMany: jest.fn() },
      cptCode: { createMany: jest.fn() },
      hcpcsCode: { createMany: jest.fn() },
      modifier: { createMany: jest.fn() },
      payerRule: { findFirst: jest.fn().mockResolvedValue({ id: 1 }), create: jest.fn() },
      rateReference: { findFirst: jest.fn().mockResolvedValue({ id: 1 }), create: jest.fn() },
      claimEditRule: { findFirst: jest.fn().mockResolvedValue({ id: 1 }), create: jest.fn() },
      medicalRecord: { findFirst: jest.fn().mockResolvedValue({ id: 1 }), create: jest.fn() },
      aiAnalysis: { findFirst: jest.fn().mockResolvedValue({ id: 1 }), create: jest.fn() },
      codingSuggestion: { count: jest.fn().mockResolvedValue(2), create: jest.fn() },
      suggestionModifier: { create: jest.fn() },
      validationResult: { findFirst: jest.fn().mockResolvedValue({ id: 1 }), create: jest.fn() },
      claim: { findFirst: jest.fn().mockResolvedValue({ id: 1 }), create: jest.fn() },
    };

    const mockPrisma = {
      ...mockTx,
      $transaction: jest.fn(async (fn) => fn(mockTx)),
    };

    await runSeed(mockPrisma, validEnv);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.role.upsert).toHaveBeenCalledTimes(4);
    expect(mockTx.user.upsert).toHaveBeenCalledTimes(8);
    // Verify user upsert never overwrites existing passwordHash or accountStatus
    for (const call of mockTx.user.upsert.mock.calls) {
      expect(call[0].update).toEqual({});
    }
    expect(mockTx.patient.create).not.toHaveBeenCalled();
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
  });
});
