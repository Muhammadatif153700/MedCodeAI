const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { assertIsolatedTestDatabase } = require('../src/config/testDbGuard');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const ENV_UPGRADE_PATH = path.join(BACKEND_ROOT, '.env.upgrade.test');
const REPO_MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'prisma', 'migrations');
const REPO_SCHEMA_PATH = path.join(BACKEND_ROOT, 'prisma', 'schema.prisma');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function loadVerifiedUpgradeEnv() {
  if (!fs.existsSync(ENV_UPGRADE_PATH)) {
    throw new Error('backend/.env.upgrade.test is required for migration upgrade testing');
  }
  const parsed = dotenv.parse(fs.readFileSync(ENV_UPGRADE_PATH));
  const env = {
    ...process.env,
    ...parsed,
    NODE_ENV: 'test',
  };
  if (env.TEST_EXPECTED_DB_NAME !== 'medcodeai_upgrade_test') {
    throw new Error('TEST_EXPECTED_DB_NAME must be medcodeai_upgrade_test');
  }
  const guard = assertIsolatedTestDatabase(env);
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in backend/.env.upgrade.test');
  }
  return { env, guard };
}

const PRISMA_BIN = path.join(
  BACKEND_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
);

function runPrisma(args, env, cwd = BACKEND_ROOT) {
  const result = spawnSync(PRISMA_BIN, args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function buildOldSchemaWorkspace() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'medcodeai-upgrade-'));
  const prismaDir = path.join(tmpRoot, 'prisma');
  const initMigDir = path.join(prismaDir, 'migrations', '20261125000000_init');
  fs.mkdirSync(initMigDir, { recursive: true });

  fs.copyFileSync(
    path.join(REPO_MIGRATIONS_DIR, '20261125000000_init', 'migration.sql'),
    path.join(initMigDir, 'migration.sql')
  );
  fs.copyFileSync(
    path.join(REPO_MIGRATIONS_DIR, 'migration_lock.toml'),
    path.join(prismaDir, 'migration_lock.toml')
  );

  let oldSchema = fs.readFileSync(REPO_SCHEMA_PATH, 'utf8');
  oldSchema = oldSchema.replace(/\s*\/\/ Phase 9B security hardening \(F-02\):\s*\n\s*tokenVersion\s+Int\s+@default\(0\)\s+@map\("token_version"\)\s*\n/, '\n');
  oldSchema = oldSchema.replace(/userId\s+Int\?\s+@map\("user_id"\).*$/m, 'userId Int @map("user_id")');
  oldSchema = oldSchema.replace(/user\s+User\?\s+@relation/m, 'user User @relation');
  fs.writeFileSync(path.join(prismaDir, 'schema.prisma'), oldSchema, 'utf8');

  return { tmpRoot, oldSchemaPath: path.join(prismaDir, 'schema.prisma') };
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Upgrade test server failed to respond on /api/v1/health');
}

async function main() {
  const { env, guard } = loadVerifiedUpgradeEnv();
  console.log('[upgrade-guard]', JSON.stringify(guard));

  const initChecksum = sha256File(path.join(REPO_MIGRATIONS_DIR, '20261125000000_init', 'migration.sql'));
  const phase9bChecksum = sha256File(
    path.join(REPO_MIGRATIONS_DIR, '20261127000000_phase9b_security_hardening', 'migration.sql')
  );
  console.log('[repo-checksums]', JSON.stringify({ initChecksum, phase9bChecksum }));

  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  let tmpWorkspace = null;

  try {
    // Step 2: Confirm empty DB
    const [dbInfo] = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS db_name, current_schema() AS schema_name'
    );
    const initialTables = await prisma.$queryRawUnsafe(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    if (dbInfo.db_name !== 'medcodeai_upgrade_test' || initialTables.length !== 0) {
      throw new Error(
        `medcodeai_upgrade_test must be empty before upgrade test (found ${initialTables.length} tables in ${dbInfo.db_name})`
      );
    }
    console.log('[step2-empty-verified]', JSON.stringify({ dbInfo, tableCount: 0 }));

    // Step 3 & 4: Isolated workspace & apply ONLY 20261125000000_init
    tmpWorkspace = buildOldSchemaWorkspace();
    const initDeployOut = runPrisma(
      ['migrate', 'deploy', `--schema=${tmpWorkspace.oldSchemaPath}`],
      env,
      tmpWorkspace.tmpRoot
    );
    console.log('[step4-init-deploy]', initDeployOut.includes('20261125000000_init') ? 'applied' : initDeployOut);

    const postInitTables = await prisma.$queryRawUnsafe(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    const postInitTokenCol = await prisma.$queryRawUnsafe(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='token_version'"
    );
    const [postInitAuditCol] = await prisma.$queryRawUnsafe(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='user_id'"
    );
    const postInitConstraints = await prisma.$queryRawUnsafe(`
      SELECT conname FROM pg_constraint
      WHERE conname IN (
        'coding_suggestions_units_positive',
        'coding_suggestions_code_reference_check',
        'rate_references_rate_non_negative',
        'encounters_plan_payer_fkey',
        'users_approved_requires_role'
      )
    `);
    if (
      postInitTables.length !== 27 ||
      postInitTokenCol.length !== 0 ||
      postInitAuditCol.is_nullable !== 'NO' ||
      postInitConstraints.length !== 5
    ) {
      throw new Error('Post-init schema state verification failed');
    }
    console.log(
      '[step4-verified]',
      JSON.stringify({
        applicationTables: 26,
        customConstraints: postInitConstraints.length,
        tokenVersionExists: false,
        auditUserIdNullable: postInitAuditCol.is_nullable,
      })
    );

    // Step 5: Populate old-schema synthetic records via parameterized SQL (NOT current Prisma Client)
    const adminPass = env.SEED_ADMIN_PASSWORD || 'UpgradeAdmin#2026!';
    const coderPass = env.SEED_STAFF_PASSWORD || 'UpgradeStaff#2026!';
    const pendingPass = env.SEED_PENDING_PASSWORD || 'UpgradePending#2026!';
    const adminHash = await bcrypt.hash(adminPass, 10);
    const coderHash = await bcrypt.hash(coderPass, 10);
    const pendingHash = await bcrypt.hash(pendingPass, 10);

    for (const roleName of ['ADMIN', 'BILLING_SPECIALIST', 'CODER', 'REVIEWER']) {
      await prisma.$executeRaw`INSERT INTO "roles" ("name") VALUES (${roleName})`;
    }
    const roles = await prisma.$queryRawUnsafe('SELECT id, name FROM "roles" ORDER BY id');
    const roleMap = Object.fromEntries(roles.map((r) => [r.name, r.id]));

    await prisma.$executeRaw`
      INSERT INTO "users" ("name", "email", "password_hash", "role_id", "is_active", "account_status")
      VALUES
        ('Upgrade Admin', 'upg.admin@medcodeai.test', ${adminHash}, ${roleMap.ADMIN}, true, 'APPROVED'::"AccountApprovalStatus"),
        ('Upgrade Coder', 'upg.coder@medcodeai.test', ${coderHash}, ${roleMap.CODER}, true, 'APPROVED'::"AccountApprovalStatus"),
        ('Upgrade Pending', 'upg.pending@medcodeai.test', ${pendingHash}, NULL, true, 'PENDING'::"AccountApprovalStatus")
    `;
    const preUsers = await prisma.$queryRawUnsafe(
      'SELECT id, email, password_hash, role_id, account_status FROM "users" ORDER BY id'
    );
    const adminUser = preUsers.find((u) => u.email === 'upg.admin@medcodeai.test');
    const coderUser = preUsers.find((u) => u.email === 'upg.coder@medcodeai.test');

    await prisma.$executeRaw`
      INSERT INTO "audit_logs" ("user_id", "action", "entity", "entity_id", "ip_address")
      VALUES
        (${adminUser.id}, 'USER_LOGIN_SUCCESS', 'USER', ${adminUser.id}, '127.0.0.1'),
        (${coderUser.id}, 'USER_LOGIN_SUCCESS', 'USER', ${coderUser.id}, '127.0.0.1')
    `;

    await prisma.$executeRaw`
      INSERT INTO "patients" ("name", "dob", "gender", "member_id")
      VALUES ('Upgrade Patient', '1988-03-14'::date, 'Female', 'UPG-MEM-001')
    `;
    await prisma.$executeRaw`
      INSERT INTO "providers" ("name", "npi", "specialty")
      VALUES ('Dr. Upgrade Provider', '0098765432', 'Cardiology')
    `;
    await prisma.$executeRaw`
      INSERT INTO "payers" ("name", "contact")
      VALUES ('Upgrade Payer A', 'payerA@medcodeai.test'), ('Upgrade Payer B', 'payerB@medcodeai.test')
    `;
    const payers = await prisma.$queryRawUnsafe('SELECT id, name FROM "payers" ORDER BY id');
    await prisma.$executeRaw`
      INSERT INTO "insurance_plans" ("payer_id", "name", "auth_required")
      VALUES (${payers[0].id}, 'Upgrade Gold Plan', false), (${payers[1].id}, 'Upgrade Silver Plan', true)
    `;
    const [pat] = await prisma.$queryRawUnsafe('SELECT id FROM "patients" LIMIT 1');
    const [prov] = await prisma.$queryRawUnsafe('SELECT id FROM "providers" LIMIT 1');
    const plans = await prisma.$queryRawUnsafe('SELECT id, payer_id FROM "insurance_plans" ORDER BY id');

    await prisma.$executeRaw`
      INSERT INTO "encounters" ("patient_id", "provider_id", "payer_id", "plan_id", "encounter_date", "place_of_service", "status")
      VALUES (${pat.id}, ${prov.id}, ${plans[0].payer_id}, ${plans[0].id}, '2026-10-01'::date, '11', 'OPEN'::"EncounterStatus")
    `;
    const [enc] = await prisma.$queryRawUnsafe('SELECT id FROM "encounters" LIMIT 1');
    await prisma.$executeRaw`
      INSERT INTO "medical_records" ("encounter_id", "uploaded_by", "file_path", "file_type", "status")
      VALUES (${enc.id}, ${coderUser.id}, '/upgrade/note.pdf', 'application/pdf', 'UPLOADED'::"MedicalRecordStatus")
    `;
    await prisma.$executeRaw`INSERT INTO "icd10_codes" ("code", "description") VALUES ('UPG-I10', 'Upgrade Hypertension')`;
    await prisma.$executeRaw`INSERT INTO "cpt_codes" ("code", "description") VALUES ('UPG-99213', 'Upgrade Office Visit')`;
    await prisma.$executeRaw`
      INSERT INTO "rate_references" ("payer_id", "code", "place_of_service", "geo_area", "rate", "effective_date")
      VALUES (${payers[0].id}, 'UPG-99213', '11', '00', 125.00, '2026-01-01'::date)
    `;

    const preCounts = {
      roles: 4,
      users: preUsers.length,
      auditLogs: 2,
      patients: 1,
      providers: 1,
      payers: 2,
      plans: 2,
      encounters: 1,
      medicalRecords: 1,
    };
    const preUserFingerprints = preUsers.map((u) => ({
      id: u.id,
      email: u.email,
      hashSha256: crypto.createHash('sha256').update(u.password_hash).digest('hex'),
    }));
    console.log('[step5-pre-migration]', JSON.stringify({ preCounts, preUserCount: preUserFingerprints.length }));

    // Step 6: Apply 20261127000000_phase9b_security_hardening via repo prisma migrate deploy
    const upgradeDeployOut = runPrisma(['migrate', 'deploy'], env, BACKEND_ROOT);
    console.log(
      '[step6-upgrade-deploy]',
      upgradeDeployOut.includes('20261127000000_phase9b_security_hardening') ? 'applied' : upgradeDeployOut
    );

    const postUsers = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    const postCounts = {
      roles: await prisma.role.count(),
      users: postUsers.length,
      auditLogs: await prisma.auditLog.count(),
      patients: await prisma.patient.count(),
      providers: await prisma.provider.count(),
      payers: await prisma.payer.count(),
      plans: await prisma.insurancePlan.count(),
      encounters: await prisma.encounter.count(),
      medicalRecords: await prisma.medicalRecord.count(),
    };
    if (JSON.stringify(preCounts) !== JSON.stringify(postCounts)) {
      throw new Error(`Row count mismatch after upgrade: ${JSON.stringify({ preCounts, postCounts })}`);
    }
    for (const fp of preUserFingerprints) {
      const match = postUsers.find((u) => u.id === fp.id);
      const afterSha = crypto.createHash('sha256').update(match.passwordHash).digest('hex');
      if (!match || afterSha !== fp.hashSha256 || match.tokenVersion !== 0) {
        throw new Error(`User preservation/tokenVersion failed for user id ${fp.id}`);
      }
    }
    const postAudits = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    if (postAudits[0].userId !== adminUser.id || postAudits[1].userId !== coderUser.id) {
      throw new Error('Existing audit actor IDs changed after upgrade');
    }
    const [postAuditCol] = await prisma.$queryRawUnsafe(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='user_id'"
    );
    const postConstraints = await prisma.$queryRawUnsafe(`
      SELECT conname FROM pg_constraint
      WHERE conname IN (
        'coding_suggestions_units_positive',
        'coding_suggestions_code_reference_check',
        'rate_references_rate_non_negative',
        'encounters_plan_payer_fkey',
        'users_approved_requires_role'
      )
    `);
    const migRows = await prisma.$queryRawUnsafe(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at ASC'
    );
    if (postAuditCol.is_nullable !== 'YES' || postConstraints.length !== 5 || migRows.length !== 2) {
      throw new Error('Post-upgrade schema/constraint/migration history check failed');
    }
    console.log(
      '[step6-verified]',
      JSON.stringify({
        postCounts,
        allUsersTokenVersionZero: true,
        passwordHashesPreserved: true,
        auditActorIdsPreserved: true,
        auditUserIdNullable: postAuditCol.is_nullable,
        customConstraints: postConstraints.length,
        migrations: migRows.map((m) => ({
          name: m.migration_name,
          checksumMatch:
            m.migration_name === '20261125000000_init'
              ? m.checksum.toUpperCase() === initChecksum
              : m.checksum.toUpperCase() === phase9bChecksum,
          rolledBackAt: m.rolled_back_at,
        })),
      })
    );

    // Step 7, 8, 9: Live server verification against upgraded medcodeai_upgrade_test
    const port = 5097;
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: BACKEND_ROOT,
      env: { ...env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await waitForHealth(baseUrl);

      // Existing approved user login -> tv: 0
      const adminLogin = await (
        await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: adminUser.email, password: adminPass }),
        })
      ).json();
      const adminToken = adminLogin.data.token;
      const decodedAdmin = jwt.decode(adminToken);

      const coderLogin = await (
        await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: coderUser.email, password: coderPass }),
        })
      ).json();
      const coderToken = coderLogin.data.token;

      // Pending user blocked
      const pendingRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'upg.pending@medcodeai.test', password: pendingPass }),
      });

      // Profile & legacy JWT without tv rejected
      const profileRes = await fetch(`${baseUrl}/api/v1/profile`, {
        headers: { Authorization: `Bearer ${coderToken}` },
      });
      const legacyToken = jwt.sign(
        { sub: String(coderUser.id), role: 'CODER' },
        env.JWT_SECRET,
        { expiresIn: '1h', issuer: env.JWT_ISSUER || 'medcodeai-api', audience: env.JWT_AUDIENCE || 'medcodeai-client' }
      );
      const legacyRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${legacyToken}` },
      });

      // Password change increments tokenVersion, revokes old token, new password works
      const newCoderPass = 'UpgradeCoderNew#2026!';
      const pwRes = await fetch(`${baseUrl}/api/v1/profile/password`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${coderToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: coderPass, newPassword: newCoderPass }),
      });
      const oldTokAfterPw = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${coderToken}` },
      });
      const newLogin = await (
        await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: coderUser.email, password: newCoderPass }),
        })
      ).json();

      // Disable coder & verify blocked
      await fetch(`${baseUrl}/api/v1/users/${coderUser.id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });
      const disabledLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: coderUser.email, password: newCoderPass }),
      });

      // Unknown-email login failure -> null actor audit log
      const unknownFail = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@medcodeai.test', password: 'WrongPassword123!' }),
      });
      const auditRes = await (
        await fetch(`${baseUrl}/api/v1/audit-logs?limit=20`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
      ).json();
      const nullAuditRow = auditRes.data.find((a) => a.userId === null && a.action === 'USER_LOGIN_FAILED');

      // Existing medical data & payer-plan mismatch & delete protection
      const patGet = await fetch(`${baseUrl}/api/v1/patients/${pat.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const provGet = await fetch(`${baseUrl}/api/v1/providers/${prov.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const encGet = await fetch(`${baseUrl}/api/v1/encounters/${enc.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const mismatchEnc = await fetch(`${baseUrl}/api/v1/encounters`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: pat.id,
          providerId: prov.id,
          payerId: payers[0].id,
          planId: plans[1].id,
          encounterDate: '2026-10-15',
          placeOfService: '11',
        }),
      });
      const delPatBlocked = await fetch(`${baseUrl}/api/v1/patients/${pat.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      console.log(
        '[step7-9-live-verified]',
        JSON.stringify({
          adminTv: decodedAdmin.tv,
          pendingStatus: pendingRes.status,
          profileStatus: profileRes.status,
          legacyNoTvStatus: legacyRes.status,
          pwChangeStatus: pwRes.status,
          oldTokenRevokedStatus: oldTokAfterPw.status,
          newLoginTv: jwt.decode(newLogin.data.token).tv,
          disabledLoginStatus: disabledLogin.status,
          unknownFailStatus: unknownFail.status,
          nullActorAuditPersisted: Boolean(nullAuditRow && nullAuditRow.user === null),
          patStatus: patGet.status,
          provStatus: provGet.status,
          encStatus: encGet.status,
          payerPlanMismatchStatus: mismatchEnc.status,
          dependentDeleteBlockedStatus: delPatBlocked.status,
        })
      );
    } finally {
      child.kill('SIGTERM');
    }

    // Step 10: Idempotency — re-run prisma migrate deploy
    const idempOut = runPrisma(['migrate', 'deploy'], env, BACKEND_ROOT);
    const finalMigCount = (await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS c FROM "_prisma_migrations"'))[0].c;
    const finalTokenCols = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*)::int AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='token_version'"
    );
    console.log(
      '[step10-idempotency]',
      JSON.stringify({
        noPendingMigrations: idempOut.includes('No pending migrations to apply'),
        migrationRowCount: finalMigCount,
        tokenVersionColCount: finalTokenCols[0].c,
      })
    );
  } finally {
    await prisma.$disconnect();
    if (tmpWorkspace && fs.existsSync(tmpWorkspace.tmpRoot)) {
      fs.rmSync(tmpWorkspace.tmpRoot, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error('[upgrade-test] Error:', err.message);
  process.exit(1);
});
