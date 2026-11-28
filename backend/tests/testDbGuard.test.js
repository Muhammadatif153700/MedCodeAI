const {
  BLOCKED_DEV_ENDPOINTS,
  assertIsolatedTestDatabase,
} = require('../src/config/testDbGuard');

function buildValidTestEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    TEST_APPROVED_ENDPOINTS: 'ep-isolated-test-123456',
    TEST_EXPECTED_DB_NAME: 'medcodeai',
    DATABASE_URL:
      'postgresql://test_user:test_pass@ep-isolated-test-123456-pooler.us-east-2.aws.neon.tech/medcodeai?sslmode=require',
    DIRECT_URL:
      'postgresql://test_user:test_pass@ep-isolated-test-123456.us-east-2.aws.neon.tech/medcodeai?sslmode=require',
    ...overrides,
  };
}

describe('Isolated Test Database Guard (testDbGuard)', () => {
  test('allows an explicitly allowlisted disposable Neon test endpoint', () => {
    const result = assertIsolatedTestDatabase(buildValidTestEnv());
    expect(result).toEqual({
      endpointId: 'ep-isolated-test-123456',
      databaseName: 'medcodeai',
      verified: true,
    });
  });

  test('rejects non-test NODE_ENV', () => {
    expect(() =>
      assertIsolatedTestDatabase(buildValidTestEnv({ NODE_ENV: 'development' }))
    ).toThrow('Integration tests require NODE_ENV=test');
  });

  test('rejects missing TEST_APPROVED_ENDPOINTS', () => {
    expect(() =>
      assertIsolatedTestDatabase(buildValidTestEnv({ TEST_APPROVED_ENDPOINTS: '' }))
    ).toThrow('TEST_APPROVED_ENDPOINTS must be explicitly configured');
  });

  test('blocks ali_dev endpoint even if mistakenly added to TEST_APPROVED_ENDPOINTS', () => {
    const devEndpoint = BLOCKED_DEV_ENDPOINTS[0];
    expect(() =>
      assertIsolatedTestDatabase(
        buildValidTestEnv({
          TEST_APPROVED_ENDPOINTS: devEndpoint,
          DATABASE_URL: `postgresql://u:p@${devEndpoint}-pooler.us-east-2.aws.neon.tech/medcodeai`,
          DIRECT_URL: `postgresql://u:p@${devEndpoint}.us-east-2.aws.neon.tech/medcodeai`,
        })
      )
    ).toThrow(`Refusing to run integration tests against protected endpoint "${devEndpoint}"`);
  });

  test('blocks production hostnames', () => {
    expect(() =>
      assertIsolatedTestDatabase(
        buildValidTestEnv({
          TEST_APPROVED_ENDPOINTS: 'ep-production-123',
          DATABASE_URL:
            'postgresql://u:p@ep-production-123-pooler.us-east-2.aws.neon.tech/medcodeai',
          DIRECT_URL: 'postgresql://u:p@ep-production-123.us-east-2.aws.neon.tech/medcodeai',
        })
      )
    ).toThrow('Refusing to run integration tests against protected endpoint');
  });

  test('rejects non-pooled DATABASE_URL and pooled DIRECT_URL', () => {
    expect(() =>
      assertIsolatedTestDatabase(
        buildValidTestEnv({
          DATABASE_URL:
            'postgresql://u:p@ep-isolated-test-123456.us-east-2.aws.neon.tech/medcodeai',
        })
      )
    ).toThrow('DATABASE_URL must be a Neon pooled (-pooler) endpoint');

    expect(() =>
      assertIsolatedTestDatabase(
        buildValidTestEnv({
          DIRECT_URL:
            'postgresql://u:p@ep-isolated-test-123456-pooler.us-east-2.aws.neon.tech/medcodeai',
        })
      )
    ).toThrow('DIRECT_URL must be a Neon direct (non-pooler) endpoint');
  });

  test('rejects endpoint mismatch, DB name mismatch, and unapproved endpoints', () => {
    expect(() =>
      assertIsolatedTestDatabase(
        buildValidTestEnv({
          DIRECT_URL: 'postgresql://u:p@ep-other-999.us-east-2.aws.neon.tech/medcodeai',
        })
      )
    ).toThrow('DATABASE_URL and DIRECT_URL must target the same Neon endpoint');

    expect(() =>
      assertIsolatedTestDatabase(
        buildValidTestEnv({
          DATABASE_URL:
            'postgresql://u:p@ep-isolated-test-123456-pooler.us-east-2.aws.neon.tech/wrong_db',
        })
      )
    ).toThrow('Database name mismatch');

    expect(() =>
      assertIsolatedTestDatabase(
        buildValidTestEnv({
          TEST_APPROVED_ENDPOINTS: 'ep-different-approved',
        })
      )
    ).toThrow('Refusing to run integration tests on unapproved endpoint');
  });
});
