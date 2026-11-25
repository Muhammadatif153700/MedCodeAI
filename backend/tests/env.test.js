const { validateEnv } = require('../src/config/env');

describe('Environment Configuration Validation (Task 4 & Test 8)', () => {
  test('8a. Applies safe defaults when optional variables are omitted', () => {
    const parsed = validateEnv({});
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.PORT).toBe(5000);
    expect(parsed.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(parsed.DATABASE_URL).toBe('');
    expect(parsed.JWT_SECRET).toBe('');
    expect(parsed.JWT_EXPIRES_IN).toBe('1h');
  });

  test('8b. Parses comma-separated CORS_ORIGINS and numeric PORT', () => {
    const parsed = validateEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      CORS_ORIGINS: 'https://app.medcode.ai, http://localhost:3000',
    });

    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.PORT).toBe(8080);
    expect(parsed.CORS_ORIGINS).toEqual([
      'https://app.medcode.ai',
      'http://localhost:3000',
    ]);
  });

  test('8c. Rejects invalid NODE_ENV or PORT', () => {
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
});
