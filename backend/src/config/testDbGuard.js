const path = require('path');
const dotenv = require('dotenv');

const BLOCKED_DEV_ENDPOINTS = Object.freeze(['ep-mute-sunset-bixgh0vc']); // ali_dev

function parseEndpointAndDb(rawUrl, label) {
  if (!rawUrl) {
    throw new Error(`${label} is required for integration testing`);
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(`${label} must use postgres:// or postgresql://`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const isPooler = hostname.includes('-pooler');
  const endpointId = hostname.replace('-pooler', '').split('.')[0];
  const dbName = parsed.pathname.replace(/^\//, '');

  return { hostname, isPooler, endpointId, dbName };
}

/**
 * Validates that an integration test process is strictly isolated to an
 * approved disposable Neon test branch and cannot touch ali_dev or production.
 * Never logs or returns connection strings or passwords.
 * @param {Record<string, string | undefined>} [envObj=process.env]
 */
function assertIsolatedTestDatabase(envObj = process.env) {
  if (envObj.NODE_ENV !== 'test') {
    throw new Error('Integration tests require NODE_ENV=test');
  }

  const approvedEndpoints = String(envObj.TEST_APPROVED_ENDPOINTS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (approvedEndpoints.length === 0) {
    throw new Error(
      'TEST_APPROVED_ENDPOINTS must be explicitly configured with a disposable Neon endpoint ID'
    );
  }

  const expectedDb = (envObj.TEST_EXPECTED_DB_NAME || 'medcodeai').trim();
  if (!expectedDb) {
    throw new Error('TEST_EXPECTED_DB_NAME must not be empty');
  }

  const pooled = parseEndpointAndDb(envObj.DATABASE_URL, 'DATABASE_URL');
  const direct = parseEndpointAndDb(envObj.DIRECT_URL, 'DIRECT_URL');

  if (!pooled.isPooler) {
    throw new Error('DATABASE_URL must be a Neon pooled (-pooler) endpoint');
  }
  if (direct.isPooler) {
    throw new Error('DIRECT_URL must be a Neon direct (non-pooler) endpoint');
  }
  if (pooled.endpointId !== direct.endpointId) {
    throw new Error('DATABASE_URL and DIRECT_URL must target the same Neon endpoint');
  }
  if (pooled.dbName !== expectedDb || direct.dbName !== expectedDb) {
    throw new Error(`Database name mismatch: expected "${expectedDb}"`);
  }

  if (
    pooled.hostname.includes('production') ||
    direct.hostname.includes('production') ||
    BLOCKED_DEV_ENDPOINTS.includes(pooled.endpointId)
  ) {
    throw new Error(
      `Refusing to run integration tests against protected endpoint "${pooled.endpointId}"`
    );
  }

  const isAllowlisted = approvedEndpoints.some(
    (entry) => entry === pooled.endpointId || entry === pooled.hostname
  );
  if (!isAllowlisted) {
    throw new Error(
      `Refusing to run integration tests on unapproved endpoint "${pooled.endpointId}"`
    );
  }

  return Object.freeze({
    endpointId: pooled.endpointId,
    databaseName: expectedDb,
    verified: true,
  });
}

function loadAndVerifyTestEnv(envFilePath = path.resolve(__dirname, '../../.env.test')) {
  dotenv.config({ path: envFilePath, override: true, quiet: true });
  return assertIsolatedTestDatabase(process.env);
}

module.exports = {
  BLOCKED_DEV_ENDPOINTS,
  assertIsolatedTestDatabase,
  loadAndVerifyTestEnv,
};
