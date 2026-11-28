const {
  validateEnv,
  assertDatabaseConfigured,
  assertJwtConfigured,
} = require('../src/config/env');

describe('Environment Configuration Validation (Phase 1 & Phase 2)', () => {
  test('Applies safe defaults when optional variables are omitted', () => {
    const parsed = validateEnv({});
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.PORT).toBe(5000);
    expect(parsed.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(parsed.DATABASE_URL).toBe('');
    expect(parsed.DIRECT_URL).toBe('');
    expect(parsed.JWT_SECRET).toBe('');
    expect(parsed.JWT_EXPIRES_IN).toBe('1h');
  });

  test('Parses comma-separated CORS_ORIGINS and numeric PORT', () => {
    const parsed = validateEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      CORS_ORIGINS: 'https://app.medcode.ai, http://localhost:3000',
      DATABASE_URL:
        'postgresql://user:pass@ep-prod-pooler.ap-southeast-1.aws.neon.tech/medcodeai?sslmode=require',
      JWT_SECRET: 'production-jwt-secret-at-least-32-characters-long',
    });

    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.PORT).toBe(8080);
    expect(parsed.CORS_ORIGINS).toEqual([
      'https://app.medcode.ai',
      'http://localhost:3000',
    ]);
  });

  test('Fails safely in production when JWT_SECRET or DATABASE_URL is missing', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /JWT_SECRET must be at least 32 characters in production/
    );
  });

  test('Rejects invalid NODE_ENV or PORT', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(
      /Invalid environment configuration/
    );
    expect(() => validateEnv({ PORT: 'not-a-number' })).toThrow(
      /Invalid environment configuration/
    );
    expect(() => validateEnv({ PORT: '70000' })).toThrow(
      /Invalid environment configuration/
    );
  });

  test('1. Accepts valid Neon PostgreSQL pooled and direct URLs', () => {
    const parsed = validateEnv({
      DATABASE_URL:
        'postgresql://user:pass@ep-demo-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
      DIRECT_URL:
        'postgres://user:pass@ep-demo.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
    });

    expect(parsed.DATABASE_URL).toContain('postgresql://');
    expect(parsed.DIRECT_URL).toContain('postgres://');
  });

  test('2. Rejects invalid DATABASE_URL or DIRECT_URL formats', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'mysql://user:pass@localhost:3306/db' })
    ).toThrow(/Invalid environment configuration/);

    expect(() =>
      validateEnv({ DIRECT_URL: 'not-a-valid-url' })
    ).toThrow(/Invalid environment configuration/);
  });

  test('Fails clearly when DATABASE_URL is required but missing', () => {
    expect(() => assertDatabaseConfigured({ DATABASE_URL: '' })).toThrow(
      /DATABASE_URL is not set/
    );
  });

  test('Fails early when JWT_SECRET is too short or missing for token operations', () => {
    expect(() => validateEnv({ JWT_SECRET: 'too-short-secret' })).toThrow(
      /JWT_SECRET must be at least 32 characters/
    );
    expect(() => assertJwtConfigured({ JWT_SECRET: '' })).toThrow(
      /JWT_SECRET must be at least 32 characters/
    );
  });
});
