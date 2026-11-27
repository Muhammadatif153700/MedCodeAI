const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const { assertIsolatedTestDatabase } = require('../src/config/testDbGuard');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const ENV_TEST_PATH = path.join(BACKEND_ROOT, '.env.test');

function buildVerifiedTestEnv() {
  if (!fs.existsSync(ENV_TEST_PATH)) {
    throw new Error('backend/.env.test is required for isolated test database commands');
  }

  const parsedTestEnv = dotenv.parse(fs.readFileSync(ENV_TEST_PATH));
  const mergedEnv = {
    ...process.env,
    ...parsedTestEnv,
    NODE_ENV: 'test',
  };

  const guardResult = assertIsolatedTestDatabase(mergedEnv);
  return { env: mergedEnv, guardResult };
}

function runGuardedChild(command, args, verifiedEnv) {
  const result = spawnSync(command, args, {
    cwd: BACKEND_ROOT,
    env: verifiedEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

async function inspectDatabaseState(verifiedEnv) {
  const prisma = new PrismaClient({
    datasources: { db: { url: verifiedEnv.DATABASE_URL } },
  });

  try {
    const [dbInfo] = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS db_name, current_schema() AS schema_name'
    );
    const tables = await prisma.$queryRawUnsafe(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    const tableNames = tables.map((row) => row.tablename);
    const hasPrismaMigrations = tableNames.includes('_prisma_migrations');
    let migrations = [];
    if (hasPrismaMigrations) {
      migrations = await prisma.$queryRawUnsafe(`
        SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
        FROM "_prisma_migrations"
        ORDER BY started_at ASC
      `);
    }

    return { dbInfo, tableNames, hasPrismaMigrations, migrations };
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyDatabaseIntegrity(verifiedEnv) {
  const prisma = new PrismaClient({
    datasources: { db: { url: verifiedEnv.DATABASE_URL } },
  });

  try {
    const state = await inspectDatabaseState(verifiedEnv);
    const appTables = state.tableNames.filter((name) => name !== '_prisma_migrations');

    const customConstraints = await prisma.$queryRawUnsafe(`
      SELECT conname, contype, conrelid::regclass::text AS table_name,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname IN (
        'coding_suggestions_units_positive',
        'coding_suggestions_code_reference_check',
        'rate_references_rate_non_negative',
        'encounters_plan_payer_fkey',
        'users_approved_requires_role'
      )
      ORDER BY conname
    `);

    const tokenVersionCol = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'token_version'
    `);

    const auditUserCol = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'audit_logs'
        AND column_name = 'user_id'
    `);

    const auditForeignKeys = await prisma.$queryRawUnsafe(`
      SELECT conname, confdeltype, confupdtype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.audit_logs'::regclass
        AND contype = 'f'
      ORDER BY conname
    `);

    const indexCountRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS index_count
      FROM pg_indexes
      WHERE schemaname = 'public'
    `);

    const fkRows = await prisma.$queryRawUnsafe(`
      SELECT conname, conrelid::regclass::text AS table_name, confdeltype, confupdtype
      FROM pg_constraint
      WHERE contype = 'f'
        AND connamespace = 'public'::regnamespace
      ORDER BY table_name, conname
    `);

    console.log(
      JSON.stringify(
        {
          dbInfo: state.dbInfo,
          applicationTableCount: appTables.length,
          hasPrismaMigrationsTable: state.hasPrismaMigrations,
          migrations: state.migrations,
          customConstraintCount: customConstraints.length,
          customConstraints,
          tokenVersionCol,
          auditUserCol,
          auditForeignKeys,
          publicIndexCount: indexCountRows[0]?.index_count ?? 0,
          foreignKeyCount: fkRows.length,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const command = process.argv[2];
  const { env, guardResult } = buildVerifiedTestEnv();
  console.log('[test-db-guard]', JSON.stringify(guardResult));

  switch (command) {
    case 'verify': {
      const state = await inspectDatabaseState(env);
      console.log(
        JSON.stringify(
          {
            dbInfo: state.dbInfo,
            tableCount: state.tableNames.length,
            tableNames: state.tableNames,
            hasPrismaMigrations: state.hasPrismaMigrations,
            migrations: state.migrations,
          },
          null,
          2
        )
      );
      break;
    }
    case 'migrate-deploy':
      runGuardedChild('npx', ['prisma', 'migrate', 'deploy'], env);
      break;
    case 'migrate-status':
      runGuardedChild('npx', ['prisma', 'migrate', 'status'], env);
      break;
    case 'seed':
      runGuardedChild('node', ['prisma/seed.js'], env);
      break;
    case 'integrity':
      await verifyDatabaseIntegrity(env);
      break;
    case 'integration':
      runGuardedChild(
        'npx',
        ['jest', '--config', 'jest.integration.config.js', '--runInBand'],
        env
      );
      break;
    default:
      throw new Error(
        `Unknown command "${command}". Use: verify | migrate-deploy | migrate-status | seed | integrity | integration`
      );
  }
}

main().catch((err) => {
  console.error('[test-db-runner] Error:', err.message);
  process.exit(1);
});
