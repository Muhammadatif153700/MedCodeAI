const { PrismaClient } = require('@prisma/client');
const { env, assertDatabaseConfigured } = require('../src/config/env');

async function verifyConnection(label, url) {
  if (!url) {
    throw new Error(`${label} URL is not configured`);
  }

  const client = new PrismaClient({
    datasources: { db: { url } },
  });

  try {
    const result = await client.$queryRaw`
      SELECT
        1 AS ok,
        current_database() AS database_name,
        current_user AS db_user,
        inet_server_port() AS server_port,
        version() AS pg_version
    `;
    const row = Array.isArray(result) ? result[0] : result;
    const parsed = new URL(url);
    const isPooler = parsed.hostname.includes('-pooler');
    const sslMode = parsed.searchParams.get('sslmode') || 'default';

    console.log(
      `[${label}] connected=true pooler=${isPooler} sslmode=${sslMode} db=${row.database_name} user=${row.db_user} port=${row.server_port}`
    );
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  assertDatabaseConfigured(env);
  await verifyConnection('POOLED (DATABASE_URL)', env.DATABASE_URL);

  if (env.DIRECT_URL) {
    await verifyConnection('DIRECT (DIRECT_URL)', env.DIRECT_URL);
  } else {
    console.warn('[DIRECT (DIRECT_URL)] not configured');
  }
}

main().catch((err) => {
  const safeMessage = err.code ? `Prisma error code ${err.code}` : 'Connection check failed';
  console.error('Database connectivity verification failed:', safeMessage);
  process.exit(1);
});
