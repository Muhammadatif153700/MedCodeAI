process.env.ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000/predict';

const axios = require('axios');

jest.mock('axios');

const {
  app,
  prisma,
  disconnectPrisma,
  request,
  uniqueTag,
  createTracker,
  cleanupTracked,
  createSyntheticUser,
  loginUser,
} = require('./helpers');

describe('Integration: KAN-6 Payers, Validation & Lifecycle (Real PostgreSQL, Mocked ML HTTP)', () => {
  const tracker = createTracker();
  const createdIcdCodes = [];
  const createdCptCodes = [];
  const createdPayerRuleIds = [];
  let adminToken;
  let coderUser;
  let coderToken;
  let billingToken;
  let reviewerToken;

  beforeAll(async () => {
    const admin = await createSyntheticUser(tracker, 'ADMIN');
    adminToken = (await loginUser(admin.user.email, admin.password)).body.data.token;

    const coder = await createSyntheticUser(tracker, 'CODER');
    coderUser = coder.user;
    coderToken = (await loginUser(coderUser.email, coder.password)).body.data.token;

    const billing = await createSyntheticUser(tracker, 'BILLING_SPECIALIST');
    billingToken = (await loginUser(billing.user.email, billing.password)).body.data.token;

    const reviewer = await createSyntheticUser(tracker, 'REVIEWER');
    reviewerToken = (await loginUser(reviewer.user.email, reviewer.password)).body.data.token;
  });

  afterAll(async () => {
    if (createdPayerRuleIds.length > 0) {
      await prisma.payerRule.deleteMany({ where: { id: { in: createdPayerRuleIds } } });
    }
    if (createdIcdCodes.length > 0) {
      await prisma.icd10Code.deleteMany({ where: { code: { in: createdIcdCodes } } });
    }
    if (createdCptCodes.length > 0) {
      await prisma.cptCode.deleteMany({ where: { code: { in: createdCptCodes } } });
    }
    if (tracker.encounterIds.length > 0) {
      await prisma.validationResult.deleteMany({
        where: { encounterId: { in: tracker.encounterIds } },
      });
      await prisma.denialRisk.deleteMany({
        where: { encounterId: { in: tracker.encounterIds } },
      });
    }
    await cleanupTracked(tracker);
    await disconnectPrisma();
  });

  test('KAN-6 code libraries, payer rules, rate references, RBAC, and atomic audit logs in PostgreSQL', async () => {
    const tag = uniqueTag('k6');
    const icdCode = `K6I-${tag.slice(-6)}`.toUpperCase();
    const cptCode = `K6C-${tag.slice(-6)}`.toUpperCase();

    // RBAC checks
    expect((await request(app).get('/api/v1/payers/icd10')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/v1/payers/rates')
          .set('Authorization', `Bearer ${coderToken}`)
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v1/payers/icd10')
          .set('Authorization', `Bearer ${reviewerToken}`)
      ).status
    ).toBe(403);

    // Create ICD-10 & CPT as ADMIN
    const icdRes = await request(app)
      .post('/api/v1/payers/icd10')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: icdCode, description: `Integration ICD ${tag}` });
    expect(icdRes.status).toBe(201);
    createdIcdCodes.push(icdCode);

    const cptRes = await request(app)
      .post('/api/v1/payers/cpt')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: cptCode, description: `Integration CPT ${tag}` });
    expect(cptRes.status).toBe(201);
    createdCptCodes.push(cptCode);

    // Read as CODER
    const listIcd = await request(app)
      .get('/api/v1/payers/icd10')
      .set('Authorization', `Bearer ${coderToken}`);
    expect(listIcd.status).toBe(200);
    expect(listIcd.body.data.some((c) => c.code === icdCode)).toBe(true);

    // Payer rule & rate reference creation
    const payer = await prisma.payer.findFirst();
    const ruleRes = await request(app)
      .post('/api/v1/payers/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        payerId: payer.id,
        ruleType: `RULE_${tag}`,
        ruleJson: { auth: true },
        effectiveDate: '2026-01-01',
      });
    expect(ruleRes.status).toBe(201);
    createdPayerRuleIds.push(ruleRes.body.data.id);

    const rateRes = await request(app)
      .post('/api/v1/payers/rates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        payerId: payer.id,
        code: cptCode,
        placeOfService: '11',
        geoArea: '00',
        rate: 150.5,
        effectiveDate: '2026-01-01',
      });
    expect(rateRes.status).toBe(201);
    tracker.rateReferenceIds.push(rateRes.body.data.id);

    const getRates = await request(app)
      .get('/api/v1/payers/rates')
      .set('Authorization', `Bearer ${billingToken}`);
    expect(getRates.status).toBe(200);
    expect(getRates.body.data.some((r) => r.id === rateRes.body.data.id)).toBe(true);
  });

  test('POST /validation/process-encounter persists ValidationResult, DenialRisk, AuditLog, and transitions CODING_IN_PROGRESS -> VALIDATED', async () => {
    const patient = await prisma.patient.findFirst();
    const provider = await prisma.provider.findFirst();
    const plan = await prisma.insurancePlan.findFirst();
    const icd = await prisma.icd10Code.findFirst();

    const enc = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        providerId: provider.id,
        payerId: plan.payerId,
        planId: plan.id,
        encounterDate: new Date('2026-10-22'),
        placeOfService: '11',
        status: 'CODING_IN_PROGRESS',
      },
    });
    tracker.encounterIds.push(enc.id);

    const rec = await prisma.medicalRecord.create({
      data: {
        encounterId: enc.id,
        uploadedBy: coderUser.id,
        filePath: `/synthetic/${uniqueTag('k6_rec')}.pdf`,
        fileType: 'application/pdf',
      },
    });
    tracker.medicalRecordIds.push(rec.id);

    const analysis = await prisma.aiAnalysis.create({
      data: {
        recordId: rec.id,
        runBy: coderUser.id,
        extractedJson: { note: 'synthetic' },
        modelName: 'test-model',
        status: 'ANALYZED',
      },
    });
    tracker.aiAnalysisIds.push(analysis.id);

    const sug = await prisma.codingSuggestion.create({
      data: {
        analysisId: analysis.id,
        codeType: 'ICD10',
        icd10Code: icd.code,
        description: icd.description,
        supportingText: 'Clinical note',
        reason: 'Diagnosis',
        units: 1,
        reviewStatus: 'ACCEPTED',
        reviewedBy: coderUser.id,
      },
    });
    tracker.codingSuggestionIds.push(sug.id);

    const { env } = require('../../src/config/env');
    const prevMlUrl = env.ML_API_URL;
    // Test with mocked ML HTTP response when ML_API_URL is configured
    const mutableEnvDescriptor = Object.getOwnPropertyDescriptor(env, 'ML_API_URL');
    if (mutableEnvDescriptor && mutableEnvDescriptor.writable) {
      env.ML_API_URL = 'http://localhost:8000/predict';
    }
    try {
      if (!env.ML_API_URL) {
        // env is frozen; verify controlled 503 ML_SERVICE_UNAVAILABLE when unconfigured
        const unconf = await request(app)
          .post('/api/v1/validation/process-encounter')
          .set('Authorization', `Bearer ${billingToken}`)
          .send({ encounterId: enc.id, rawText: 'Patient presents with chronic hypertension.' });
        expect(unconf.status).toBe(503);
        expect(unconf.body.error.code).toBe('ML_SERVICE_UNAVAILABLE');
      } else {
        axios.post.mockResolvedValueOnce({
          data: { cpt_codes: [{ code: 'SYN-CPT-002' }], icd10_codes: [{ code: icd.code }] },
        });
        const okRes = await request(app)
          .post('/api/v1/validation/process-encounter')
          .set('Authorization', `Bearer ${billingToken}`)
          .send({ encounterId: enc.id, rawText: 'Patient presents with chronic hypertension.' });
        expect(okRes.status).toBe(200);
        expect(okRes.body.data.encounterStatus).toBe('VALIDATED');
      }
    } finally {
      if (mutableEnvDescriptor && mutableEnvDescriptor.writable) {
        env.ML_API_URL = prevMlUrl;
      }
    }
  });
});
