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

  const pooledParsed = new URL(env.DATABASE_URL);
  const directParsed = env.DIRECT_URL ? new URL(env.DIRECT_URL) : null;
  console.log(
    `[CONFIG] pooled_has_pooler=${pooledParsed.hostname.includes('-pooler')} direct_has_pooler=${directParsed ? directParsed.hostname.includes('-pooler') : 'n/a'} same_endpoint=${directParsed ? pooledParsed.hostname.replace('-pooler', '') === directParsed.hostname : 'n/a'} same_db=${directParsed ? pooledParsed.pathname === directParsed.pathname : 'n/a'} endpoint_id=${(directParsed || pooledParsed).hostname.replace('-pooler', '').split('.')[0]}`
  );

  await verifyConnection('POOLED (DATABASE_URL)', env.DATABASE_URL);

  if (env.DIRECT_URL) {
    await verifyConnection('DIRECT (DIRECT_URL)', env.DIRECT_URL);
  } else {
    console.warn('[DIRECT (DIRECT_URL)] not configured');
  }

  const checkClient = new PrismaClient();
  try {
    const tables = await checkClient.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    console.log(`[TABLES] count=${tables.length} names=${tables.map((t) => t.table_name).join(',') || 'none'}`);

    if (process.argv.includes('--full')) {
      const constraints = await checkClient.$queryRaw`
        SELECT conname
        FROM pg_constraint
        WHERE conname IN (
          'coding_suggestions_units_positive',
          'coding_suggestions_code_reference_check',
          'rate_references_rate_non_negative',
          'encounters_plan_payer_fkey',
          'users_approved_requires_role'
        )
        ORDER BY conname
      `;
      console.log(`[CONSTRAINTS] count=${constraints.length} names=${constraints.map((c) => c.conname).join(',')}`);

      const migrations = await checkClient.$queryRaw`
        SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count
        FROM _prisma_migrations
        ORDER BY started_at
      `;
      console.log(`[MIGRATIONS] ${JSON.stringify(migrations)}`);

      const counts = {
        roles: await checkClient.role.count(),
        users: await checkClient.user.count(),
        patients: await checkClient.patient.count(),
        providers: await checkClient.provider.count(),
        payers: await checkClient.payer.count(),
        insurancePlans: await checkClient.insurancePlan.count(),
        encounters: await checkClient.encounter.count(),
        icd10Codes: await checkClient.icd10Code.count(),
        cptCodes: await checkClient.cptCode.count(),
        hcpcsCodes: await checkClient.hcpcsCode.count(),
        modifiers: await checkClient.modifier.count(),
        payerRules: await checkClient.payerRule.count(),
        claimEditRules: await checkClient.claimEditRule.count(),
        rateReferences: await checkClient.rateReference.count(),
        medicalRecords: await checkClient.medicalRecord.count(),
        aiAnalyses: await checkClient.aiAnalysis.count(),
        codingSuggestions: await checkClient.codingSuggestion.count(),
        suggestionModifiers: await checkClient.suggestionModifier.count(),
        validationResults: await checkClient.validationResult.count(),
        claims: await checkClient.claim.count(),
      };
      console.log(`[COUNTS] ${JSON.stringify(counts)}`);
    }
  } finally {
    await checkClient.$disconnect();
  }
}

main().catch((err) => {
  const safeMessage = err.code ? `Prisma error code ${err.code}` : 'Connection check failed';
  console.error('Database connectivity verification failed:', safeMessage);
  process.exit(1);
});
