const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

if (!(process.env.NODE_ENV === 'test' && process.env.TEST_APPROVED_ENDPOINTS)) {
  dotenv.config({
    path: path.resolve(__dirname, '../.env'),
    quiet: true,
  });
}

const BCRYPT_ROUNDS = 10;

/**
 * Validates that seeding is explicitly confirmed for a non-production target
 * and that required private seed passwords are provided via environment variables.
 * @param {Record<string, string | undefined>} envObj
 */
function validateSeedConfig(envObj = process.env) {
  if (envObj.NODE_ENV === 'production') {
    throw new Error('Refusing to run seed script in production NODE_ENV');
  }

  if (!envObj.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (envObj.DATABASE_URL.toLowerCase().includes('production')) {
    throw new Error('Refusing to run seed script against a production database URL');
  }

  if (envObj.CONFIRM_DEV_SEED !== 'true') {
    throw new Error(
      'Development seed confirmation missing: set CONFIRM_DEV_SEED=true to run'
    );
  }

  if (!envObj.SEED_TARGET_BRANCH || envObj.SEED_TARGET_BRANCH.toLowerCase() === 'production') {
    throw new Error(
      'SEED_TARGET_BRANCH must be set to a non-production development branch (e.g. ali_dev)'
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(envObj.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  const actualHost = parsedUrl.hostname.toLowerCase();
  const actualEndpointId = actualHost.replace('-pooler', '').split('.')[0];
  const approvedList = String(envObj.SEED_APPROVED_ENDPOINTS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (approvedList.length === 0) {
    throw new Error(
      'SEED_APPROVED_ENDPOINTS must list at least one approved development Neon endpoint ID or hostname'
    );
  }

  const isApprovedEndpoint = approvedList.some(
    (entry) => entry === actualEndpointId || entry === actualHost
  );
  if (!isApprovedEndpoint) {
    throw new Error(
      `Refusing to seed unapproved database endpoint "${actualEndpointId}"`
    );
  }

  for (const key of [
    'SEED_ADMIN_PASSWORD',
    'SEED_STAFF_PASSWORD',
    'SEED_PENDING_PASSWORD',
  ]) {
    if (!envObj[key] || String(envObj[key]).trim().length < 8) {
      throw new Error(`${key} must be set in environment (minimum 8 characters)`);
    }
  }
}

async function hashSeedPassword(plainText) {
  return bcrypt.hash(plainText, BCRYPT_ROUNDS);
}

async function seedReferenceAndCoreData(tx, envObj) {
  // 1. Business Roles (4 confirmed roles)
  const roleNames = ['ADMIN', 'BILLING_SPECIALIST', 'CODER', 'REVIEWER'];
  const rolesByName = {};
  for (const name of roleNames) {
    rolesByName[name] = await tx.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // 2. Users (1 Admin, 2 Billing, 2 Coders, 2 Reviewers, 1 Pending)
  // Never overwrite existing user passwords or account states on repeated runs.
  const adminHash = await hashSeedPassword(envObj.SEED_ADMIN_PASSWORD);
  const staffHash = await hashSeedPassword(envObj.SEED_STAFF_PASSWORD);
  const pendingHash = await hashSeedPassword(envObj.SEED_PENDING_PASSWORD);

  const userSpecs = [
    {
      name: 'Synthetic Admin',
      email: 'admin.demo@medcodeai.local',
      passwordHash: adminHash,
      roleId: rolesByName.ADMIN.id,
      isActive: true,
      accountStatus: 'APPROVED',
    },
    {
      name: 'Synthetic Billing One',
      email: 'billing1.demo@medcodeai.local',
      passwordHash: staffHash,
      roleId: rolesByName.BILLING_SPECIALIST.id,
      isActive: true,
      accountStatus: 'APPROVED',
    },
    {
      name: 'Synthetic Billing Two',
      email: 'billing2.demo@medcodeai.local',
      passwordHash: staffHash,
      roleId: rolesByName.BILLING_SPECIALIST.id,
      isActive: true,
      accountStatus: 'APPROVED',
    },
    {
      name: 'Synthetic Coder One',
      email: 'coder1.demo@medcodeai.local',
      passwordHash: staffHash,
      roleId: rolesByName.CODER.id,
      isActive: true,
      accountStatus: 'APPROVED',
    },
    {
      name: 'Synthetic Coder Two',
      email: 'coder2.demo@medcodeai.local',
      passwordHash: staffHash,
      roleId: rolesByName.CODER.id,
      isActive: true,
      accountStatus: 'APPROVED',
    },
    {
      name: 'Synthetic Reviewer One',
      email: 'reviewer1.demo@medcodeai.local',
      passwordHash: staffHash,
      roleId: rolesByName.REVIEWER.id,
      isActive: true,
      accountStatus: 'APPROVED',
    },
    {
      name: 'Synthetic Reviewer Two',
      email: 'reviewer2.demo@medcodeai.local',
      passwordHash: staffHash,
      roleId: rolesByName.REVIEWER.id,
      isActive: true,
      accountStatus: 'APPROVED',
    },
    {
      name: 'Synthetic Pending Visitor',
      email: 'pending.demo@medcodeai.local',
      passwordHash: pendingHash,
      roleId: null,
      isActive: true,
      accountStatus: 'PENDING',
    },
  ];

  const usersByEmail = {};
  for (const spec of userSpecs) {
    usersByEmail[spec.email] = await tx.user.upsert({
      where: { email: spec.email },
      update: {},
      create: spec,
    });
  }

  // 3. Ten Fictional Patients (non-production synthetic records)
  const patients = [];
  for (let i = 1; i <= 10; i += 1) {
    const memberId = `SYN-MEM-${String(i).padStart(4, '0')}`;
    let patient = await tx.patient.findFirst({ where: { memberId } });
    if (!patient) {
      patient = await tx.patient.create({
        data: {
          name: `Synthetic Patient ${i}`,
          dob: new Date(Date.UTC(1975 + i, (i - 1) % 12, 10 + i)),
          gender: i % 2 === 0 ? 'Female' : 'Male',
          memberId,
        },
      });
    }
    patients.push(patient);
  }

  // 4. Five Fictional Providers
  const specialties = [
    'Internal Medicine',
    'Cardiology',
    'Orthopedics',
    'Family Medicine',
    'Pulmonology',
  ];
  const providers = [];
  for (let i = 1; i <= 5; i += 1) {
    const npi = `900000000${i}`;
    const provider = await tx.provider.upsert({
      where: { npi },
      update: {},
      create: {
        name: `Dr. Synthetic Provider ${i}`,
        npi,
        specialty: specialties[i - 1],
      },
    });
    providers.push(provider);
  }

  // 5. Three Fictional Payers & Six Insurance Plans
  const payerSpecs = [
    { name: 'DemoHealth Payer Alpha (Non-Prod)', contact: 'demo-alpha@synthetic.local' },
    { name: 'SyntheticCare Beta (Non-Prod)', contact: 'demo-beta@synthetic.local' },
    { name: 'TestShield Gamma (Non-Prod)', contact: 'demo-gamma@synthetic.local' },
  ];
  const payers = [];
  const plans = [];
  for (const pSpec of payerSpecs) {
    const payer = await tx.payer.upsert({
      where: { name: pSpec.name },
      update: {},
      create: pSpec,
    });
    payers.push(payer);

    for (const planSuffix of ['Standard Plan', 'Plus Plan']) {
      const planName = `${payer.name.split(' ')[0]} ${planSuffix}`;
      const plan = await tx.insurancePlan.upsert({
        where: { payerId_name: { payerId: payer.id, name: planName } },
        update: {},
        create: {
          payerId: payer.id,
          name: planName,
          authRequired: planSuffix === 'Plus Plan',
        },
      });
      plans.push(plan);
    }
  }

  // 6. Fifteen Synthetic Encounters
  const encounters = [];
  for (let i = 0; i < 15; i += 1) {
    const patient = patients[i % patients.length];
    const provider = providers[i % providers.length];
    const plan = plans[i % plans.length];
    const encounterDate = new Date(Date.UTC(2026, 9, 1 + i));
    const placeOfService = i % 3 === 0 ? '21' : '11';

    let encounter = await tx.encounter.findFirst({
      where: {
        patientId: patient.id,
        providerId: provider.id,
        payerId: plan.payerId,
        planId: plan.id,
        encounterDate,
      },
    });
    if (!encounter) {
      encounter = await tx.encounter.create({
        data: {
          patientId: patient.id,
          providerId: provider.id,
          payerId: plan.payerId,
          planId: plan.id,
          encounterDate,
          placeOfService,
          status: 'OPEN',
        },
      });
    }
    encounters.push(encounter);
  }

  // 7. Explicitly Labeled Synthetic Medical Code & Modifier Fixtures (Non-Licensed Placeholders)
  await tx.icd10Code.createMany({
    data: [
      { code: 'SYN-ICD-001', description: '[SYNTHETIC TEST FIXTURE] Non-production diagnosis placeholder A' },
      { code: 'SYN-ICD-002', description: '[SYNTHETIC TEST FIXTURE] Non-production diagnosis placeholder B' },
      { code: 'SYN-ICD-003', description: '[SYNTHETIC TEST FIXTURE] Non-production diagnosis placeholder C' },
      { code: 'SYN-ICD-004', description: '[SYNTHETIC TEST FIXTURE] Non-production diagnosis placeholder D' },
      { code: 'SYN-ICD-005', description: '[SYNTHETIC TEST FIXTURE] Non-production diagnosis placeholder E' },
    ],
    skipDuplicates: true,
  });

  await tx.cptCode.createMany({
    data: [
      { code: 'SYN-CPT-001', description: '[SYNTHETIC TEST FIXTURE] Non-production procedure placeholder A' },
      { code: 'SYN-CPT-002', description: '[SYNTHETIC TEST FIXTURE] Non-production procedure placeholder B' },
      { code: 'SYN-CPT-003', description: '[SYNTHETIC TEST FIXTURE] Non-production procedure placeholder C' },
      { code: 'SYN-CPT-004', description: '[SYNTHETIC TEST FIXTURE] Non-production procedure placeholder D' },
      { code: 'SYN-CPT-005', description: '[SYNTHETIC TEST FIXTURE] Non-production procedure placeholder E' },
    ],
    skipDuplicates: true,
  });

  await tx.hcpcsCode.createMany({
    data: [
      { code: 'SYN-HCPCS-001', description: '[SYNTHETIC TEST FIXTURE] Non-production supply/service placeholder A' },
      { code: 'SYN-HCPCS-002', description: '[SYNTHETIC TEST FIXTURE] Non-production supply/service placeholder B' },
      { code: 'SYN-HCPCS-003', description: '[SYNTHETIC TEST FIXTURE] Non-production supply/service placeholder C' },
    ],
    skipDuplicates: true,
  });

  await tx.modifier.createMany({
    data: [
      { code: 'SM1', description: '[SYNTHETIC TEST FIXTURE] Non-production modifier 1' },
      { code: 'SM2', description: '[SYNTHETIC TEST FIXTURE] Non-production modifier 2' },
      { code: 'SM3', description: '[SYNTHETIC TEST FIXTURE] Non-production modifier 3' },
    ],
    skipDuplicates: true,
  });

  // 8. Synthetic Payer Rules, Claim-Edit Rules, and Rate References
  const effectiveDate = new Date(Date.UTC(2026, 0, 1));
  for (const payer of payers) {
    const ruleExists = await tx.payerRule.findFirst({
      where: { payerId: payer.id, ruleType: 'NON_PRODUCTION_SYNTHETIC_POLICY' },
    });
    if (!ruleExists) {
      await tx.payerRule.create({
        data: {
          payerId: payer.id,
          planId: null,
          ruleType: 'NON_PRODUCTION_SYNTHETIC_POLICY',
          ruleJson: {
            synthetic: true,
            note: 'Non-production synthetic payer policy fixture',
            requiresAuthForPlusPlan: true,
          },
          effectiveDate,
        },
      });
    }

    for (const code of ['SYN-CPT-001', 'SYN-CPT-002']) {
      const rateExists = await tx.rateReference.findFirst({
        where: { payerId: payer.id, code, placeOfService: '11', geoArea: 'SYN-GEO-01' },
      });
      if (!rateExists) {
        await tx.rateReference.create({
          data: {
            payerId: payer.id,
            code,
            placeOfService: '11',
            geoArea: 'SYN-GEO-01',
            rate: code === 'SYN-CPT-001' ? '125.00' : '210.50',
            effectiveDate,
          },
        });
      }
    }
  }

  const editPairs = [
    { ruleType: 'NON_PRODUCTION_MUTUAL_EXCLUSION', codeA: 'SYN-CPT-001', codeB: 'SYN-CPT-002', action: 'WARN' },
    { ruleType: 'NON_PRODUCTION_BUNDLING', codeA: 'SYN-CPT-003', codeB: 'SYN-CPT-004', action: 'FLAG' },
    { ruleType: 'NON_PRODUCTION_MODIFIER_CHECK', codeA: 'SYN-CPT-005', codeB: 'SYN-HCPCS-001', action: 'REQUIRE_MODIFIER' },
  ];
  for (const rule of editPairs) {
    const exists = await tx.claimEditRule.findFirst({
      where: { ruleType: rule.ruleType, codeA: rule.codeA, codeB: rule.codeB },
    });
    if (!exists) {
      await tx.claimEditRule.create({ data: rule });
    }
  }

  return { usersByEmail, encounters };
}

/**
 * Separate optional synthetic workflow fixture for cross-module integration testing.
 * Does not represent executed AI/validation/submission services.
 */
async function seedSharedFixtures(tx, { usersByEmail, encounters }) {
  const encounter = encounters[0];
  const coder = usersByEmail['coder1.demo@medcodeai.local'];
  const reviewer = usersByEmail['reviewer1.demo@medcodeai.local'];

  let record = await tx.medicalRecord.findFirst({
    where: { encounterId: encounter.id, filePath: 'synthetic/demo-encounter-01.txt' },
  });
  if (!record) {
    record = await tx.medicalRecord.create({
      data: {
        encounterId: encounter.id,
        uploadedBy: coder.id,
        filePath: 'synthetic/demo-encounter-01.txt',
        fileType: 'text/plain',
        status: 'ANALYZED',
      },
    });
  }

  let analysis = await tx.aiAnalysis.findFirst({
    where: { recordId: record.id, modelName: 'synthetic-fixture-v1' },
  });
  if (!analysis) {
    analysis = await tx.aiAnalysis.create({
      data: {
        recordId: record.id,
        runBy: coder.id,
        modelName: 'synthetic-fixture-v1',
        status: 'ANALYZED',
        extractedJson: {
          synthetic: true,
          diagnoses: ['Synthetic condition A'],
          procedures: ['Synthetic procedure A'],
        },
      },
    });
  }

  const existingSuggestions = await tx.codingSuggestion.count({
    where: { analysisId: analysis.id },
  });
  if (existingSuggestions === 0) {
    await tx.codingSuggestion.create({
      data: {
        analysisId: analysis.id,
        codeType: 'ICD10',
        icd10Code: 'SYN-ICD-001',
        description: '[SYNTHETIC TEST FIXTURE] Non-production diagnosis placeholder A',
        supportingText: 'Synthetic note excerpt A',
        reason: 'Synthetic fixture rationale',
        units: 1,
        reviewStatus: 'ACCEPTED',
        reviewedBy: reviewer.id,
        reviewComment: 'Synthetic reviewer approval fixture',
      },
    });

    const cptSuggestion = await tx.codingSuggestion.create({
      data: {
        analysisId: analysis.id,
        codeType: 'CPT',
        cptCode: 'SYN-CPT-001',
        description: '[SYNTHETIC TEST FIXTURE] Non-production procedure placeholder A',
        supportingText: 'Synthetic note excerpt B',
        reason: 'Synthetic fixture rationale',
        units: 1,
        reviewStatus: 'SUGGESTED',
      },
    });

    await tx.suggestionModifier.create({
      data: {
        suggestionId: cptSuggestion.id,
        modifierCode: 'SM1',
        reviewStatus: 'SUGGESTED',
      },
    });
  }

  const existingValidation = await tx.validationResult.findFirst({
    where: { encounterId: encounter.id, ruleType: 'SYNTHETIC_FIXTURE' },
  });
  if (!existingValidation) {
    await tx.validationResult.create({
      data: {
        encounterId: encounter.id,
        ruleType: 'SYNTHETIC_FIXTURE',
        status: 'PASSED',
        message: 'Synthetic integration fixture validation placeholder',
        modelVersion: 'synthetic-fixture-v1',
      },
    });
  }

  const existingClaim = await tx.claim.findFirst({
    where: { encounterId: encounter.id, status: 'DRAFT' },
  });
  if (!existingClaim) {
    await tx.claim.create({
      data: {
        encounterId: encounter.id,
        status: 'DRAFT',
        formDataJson: {
          synthetic: true,
          note: 'Synthetic draft claim fixture',
        },
      },
    });
  }
}

async function runSeed(prismaClient, envObj = process.env) {
  validateSeedConfig(envObj);
  const core = await seedReferenceAndCoreData(prismaClient, envObj);
  await prismaClient.$transaction(
    async (tx) => {
      await seedSharedFixtures(tx, core);
    },
    { maxWait: 15000, timeout: 30000 }
  );
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await runSeed(prisma, process.env);
    console.log(
      `Synthetic development seed completed on branch target "${process.env.SEED_TARGET_BRANCH}".`
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
}

module.exports = {
  validateSeedConfig,
  hashSeedPassword,
  runSeed,
};
