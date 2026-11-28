const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const dotenv = require('dotenv');
const newman = require('newman');
const { PrismaClient } = require('@prisma/client');
const { assertIsolatedTestDatabase } = require('../src/config/testDbGuard');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const ENV_TEST_PATH = path.join(BACKEND_ROOT, '.env.test');
const COLLECTION_PATH = path.join(REPO_ROOT, 'postman', 'MedCodeAI-KAN4.postman_collection.json');
const ENVIRONMENT_PATH = path.join(REPO_ROOT, 'postman', 'MedCodeAI-Local.postman_environment.json');

function loadVerifiedEnv() {
  if (!fs.existsSync(ENV_TEST_PATH)) {
    throw new Error('backend/.env.test is required for Newman execution');
  }
  const parsed = dotenv.parse(fs.readFileSync(ENV_TEST_PATH));
  const merged = {
    ...process.env,
    ...parsed,
    NODE_ENV: 'test',
  };
  const guard = assertIsolatedTestDatabase(merged);
  if (!merged.JWT_SECRET || merged.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in backend/.env.test');
  }
  if (!merged.SEED_ADMIN_PASSWORD || !merged.SEED_STAFF_PASSWORD) {
    throw new Error('SEED_ADMIN_PASSWORD and SEED_STAFF_PASSWORD are required in backend/.env.test');
  }
  return { env: merged, guard };
}

async function fetchSeededPlanIds(env) {
  const prisma = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });
  try {
    const plan = await prisma.insurancePlan.findFirst({ orderBy: { id: 'asc' } });
    if (!plan) {
      throw new Error('No seeded InsurancePlan found in medcodeai_test. Run test:db:seed first.');
    }
    return { payerId: String(plan.payerId), planId: String(plan.id) };
  } finally {
    await prisma.$disconnect();
  }
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Test server failed to respond on /api/v1/health within timeout');
}

function runNewman(options) {
  return new Promise((resolve, reject) => {
    newman.run(options, (err, summary) => {
      if (err) return reject(err);
      return resolve(summary);
    });
  });
}

async function main() {
  const { env, guard } = loadVerifiedEnv();
  console.log('[newman-guard]', JSON.stringify(guard));

  const { payerId, planId } = await fetchSeededPlanIds(env);
  const port = 5098;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: BACKEND_ROOT,
    env: { ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  child.stderr.on('data', (d) => {
    stderrBuf += d.toString();
  });

  try {
    await waitForHealth(baseUrl);

    const summary = await runNewman({
      collection: require(COLLECTION_PATH),
      environment: require(ENVIRONMENT_PATH),
      envVar: [
        { key: 'baseUrl', value: baseUrl },
        { key: 'adminPassword', value: env.SEED_ADMIN_PASSWORD },
        { key: 'staffPassword', value: env.SEED_STAFF_PASSWORD },
        { key: 'payerId', value: payerId },
        { key: 'planId', value: planId },
      ],
      reporters: ['cli'],
      reporter: {
        cli: {
          noSummary: false,
          noAssertions: true,
          noConsole: true,
        },
      },
    });

    const stats = summary.run.stats;
    const failures = summary.run.failures || [];
    const durationMs = summary.run.timings.completed - summary.run.timings.started;

    console.log(
      '[newman-summary]',
      JSON.stringify({
        requestsExecuted: stats.requests.total,
        requestsFailed: stats.requests.failed,
        assertionsTotal: stats.assertions.total,
        assertionsFailed: stats.assertions.failed,
        durationMs,
        failures: failures.map((f) => ({
          item: f.source?.name || 'unknown',
          test: f.error?.test || f.error?.name,
          message: f.error?.message,
        })),
      })
    );

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    if (stderrBuf) {
      console.error('[newman-server-stderr]', stderrBuf);
    }
    throw err;
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('[newman-runner] Error:', err.message);
  process.exit(1);
});
