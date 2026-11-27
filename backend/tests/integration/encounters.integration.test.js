const {
  app,
  prisma,
  disconnectPrisma,
  request,
  uniqueTag,
  createTracker,
  cleanupTracked,
  loginSeededAdmin,
  createSyntheticUser,
  loginUser,
} = require('./helpers');
const {
  startCoding,
  markValidated,
  markClaimSubmitted,
  closeEncounter,
} = require('../../src/modules/encounters');

describe('Integration: Encounters & Lifecycle (Real PostgreSQL)', () => {
  const suiteTracker = createTracker();
  const tracker = createTracker();
  let adminToken;
  let coderUser;
  let coderToken;
  let billingUser;
  let reviewerToken;

  beforeAll(async () => {
    adminToken = (await loginSeededAdmin()).token;
    const coder = await createSyntheticUser(suiteTracker, 'CODER');
    coderUser = coder.user;
    coderToken = (await loginUser(coderUser.email, coder.password)).body.data.token;

    const billing = await createSyntheticUser(suiteTracker, 'BILLING_SPECIALIST');
    billingUser = billing.user;

    const reviewer = await createSyntheticUser(suiteTracker, 'REVIEWER');
    reviewerToken = (await loginUser(reviewer.user.email, reviewer.password)).body.data.token;
  });

  afterEach(async () => {
    await cleanupTracked(tracker);
  });

  afterAll(async () => {
    await cleanupTracked(suiteTracker);
    await disconnectPrisma();
  });

  test('Encounter CRUD, FK/payer-plan mismatch validation, metadata locking, generic PATCH status rejection, RBAC, and delete guards', async () => {
    const patient = await prisma.patient.findFirst();
    const provider = await prisma.provider.findFirst();
    const payers = await prisma.payer.findMany({ include: { insurancePlans: true }, take: 2 });
    const planA = payers[0].insurancePlans[0];
    const planB = payers[1].insurancePlans[0];

    // Reviewer cannot create encounter
    expect(
      (
        await request(app)
          .post('/api/v1/encounters')
          .set('Authorization', `Bearer ${reviewerToken}`)
          .send({
            patientId: patient.id,
            providerId: provider.id,
            payerId: payers[0].id,
            planId: planA.id,
            encounterDate: '2026-10-10',
          })
      ).status
    ).toBe(403);

    // Client-supplied initial status rejected
    expect(
      (
        await request(app)
          .post('/api/v1/encounters')
          .set('Authorization', `Bearer ${coderToken}`)
          .send({
            patientId: patient.id,
            providerId: provider.id,
            payerId: payers[0].id,
            planId: planA.id,
            encounterDate: '2026-10-10',
            status: 'VALIDATED',
          })
      ).status
    ).toBe(400);

    // Invalid patient, provider, payer, plan (404), and payer-plan mismatch (400)
    for (const [badBody, expectedStatus] of [
      [{ patientId: 99999999, providerId: provider.id, payerId: payers[0].id, planId: planA.id }, 404],
      [{ patientId: patient.id, providerId: 99999999, payerId: payers[0].id, planId: planA.id }, 404],
      [{ patientId: patient.id, providerId: provider.id, payerId: 99999999, planId: planA.id }, 404],
      [{ patientId: patient.id, providerId: provider.id, payerId: payers[0].id, planId: 99999999 }, 404],
      [{ patientId: patient.id, providerId: provider.id, payerId: payers[0].id, planId: planB.id }, 400],
    ]) {
      const res = await request(app)
        .post('/api/v1/encounters')
        .set('Authorization', `Bearer ${coderToken}`)
        .send({ ...badBody, encounterDate: '2026-10-10', placeOfService: '11' });
      expect(res.status).toBe(expectedStatus);
    }

    // Valid encounter creation -> OPEN
    const createRes = await request(app)
      .post('/api/v1/encounters')
      .set('Authorization', `Bearer ${coderToken}`)
      .send({
        patientId: patient.id,
        providerId: provider.id,
        payerId: payers[0].id,
        planId: planA.id,
        encounterDate: '2026-10-10',
        placeOfService: '11',
      });
    expect(createRes.status).toBe(201);
    const encId = createRes.body.data.encounter.id;
    tracker.encounterIds.push(encId);
    expect(createRes.body.data.encounter.status).toBe('OPEN');

    // Retrieve & filter (CODER/BILLING_SPECIALIST/ADMIN allowed; REVIEWER forbidden)
    const listRes = await request(app)
      .get(`/api/v1/encounters?status=OPEN&patientId=${patient.id}&page=1&limit=20`)
      .set('Authorization', `Bearer ${coderToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((e) => e.id === encId)).toBe(true);

    // Generic PATCH cannot set status
    const badPatch = await request(app)
      .patch(`/api/v1/encounters/${encId}`)
      .set('Authorization', `Bearer ${coderToken}`)
      .send({ status: 'VALIDATED' });
    expect(badPatch.status).toBe(400);

    // Valid metadata update while OPEN
    const okPatch = await request(app)
      .patch(`/api/v1/encounters/${encId}`)
      .set('Authorization', `Bearer ${coderToken}`)
      .send({ encounterDate: '2026-10-11' });
    expect(okPatch.status).toBe(200);

    // Add dependent MedicalRecord -> metadata update & deletion blocked
    const rec = await prisma.medicalRecord.create({
      data: {
        encounterId: encId,
        uploadedBy: coderUser.id,
        filePath: `/synthetic/${uniqueTag('enc_rec')}.pdf`,
        fileType: 'application/pdf',
      },
    });
    tracker.medicalRecordIds.push(rec.id);

    const lockedPatch = await request(app)
      .patch(`/api/v1/encounters/${encId}`)
      .set('Authorization', `Bearer ${coderToken}`)
      .send({ encounterDate: '2026-10-12' });
    expect(lockedPatch.status).toBe(409);

    const blockedDel = await request(app)
      .delete(`/api/v1/encounters/${encId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(blockedDel.status).toBe(409);

    // Create empty encounter -> admin delete succeeds
    const emptyRes = await request(app)
      .post('/api/v1/encounters')
      .set('Authorization', `Bearer ${coderToken}`)
      .send({
        patientId: patient.id,
        providerId: provider.id,
        payerId: payers[0].id,
        planId: planA.id,
        encounterDate: '2026-10-13',
        placeOfService: '11',
      });
    const emptyId = emptyRes.body.data.encounter.id;
    tracker.encounterIds.push(emptyId);

    const okDel = await request(app)
      .delete(`/api/v1/encounters/${emptyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(okDel.status).toBe(200);
    expect(await prisma.encounter.findUnique({ where: { id: emptyId } })).toBeNull();
  });

  test('EncounterService lifecycle enforces prerequisites, cross-encounter isolation, closure rules, and documents partial/stale validation behavior', async () => {
    const patient = await prisma.patient.findFirst();
    const provider = await prisma.provider.findFirst();
    const plan = await prisma.insurancePlan.findFirst();
    const icd = await prisma.icd10Code.findFirst();

    const enc1 = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        providerId: provider.id,
        payerId: plan.payerId,
        planId: plan.id,
        encounterDate: new Date('2026-10-14'),
        placeOfService: '11',
        status: 'OPEN',
      },
    });
    const enc2 = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        providerId: provider.id,
        payerId: plan.payerId,
        planId: plan.id,
        encounterDate: new Date('2026-10-14'),
        placeOfService: '11',
        status: 'OPEN',
      },
    });
    tracker.encounterIds.push(enc1.id, enc2.id);

    // Artifacts on enc2 do NOT satisfy enc1
    const rec2 = await prisma.medicalRecord.create({
      data: {
        encounterId: enc2.id,
        uploadedBy: coderUser.id,
        filePath: `/synthetic/${uniqueTag('e2_rec')}.pdf`,
        fileType: 'application/pdf',
      },
    });
    tracker.medicalRecordIds.push(rec2.id);

    const coderActor = { userId: coderUser.id, role: 'CODER', ipAddress: '127.0.0.1' };
    const billingActor = {
      userId: billingUser.id,
      role: 'BILLING_SPECIALIST',
      ipAddress: '127.0.0.1',
    };

    await expect(startCoding(enc1.id, coderActor)).rejects.toMatchObject({
      statusCode: 400,
      code: 'CODING_PREREQUISITE_MISSING',
    });

    // Add record to enc1 -> startCoding succeeds
    const rec1 = await prisma.medicalRecord.create({
      data: {
        encounterId: enc1.id,
        uploadedBy: coderUser.id,
        filePath: `/synthetic/${uniqueTag('e1_rec')}.pdf`,
        fileType: 'application/pdf',
      },
    });
    tracker.medicalRecordIds.push(rec1.id);

    const started = await startCoding(enc1.id, coderActor);
    expect(started.status).toBe('CODING_IN_PROGRESS');

    // markValidated requires accepted/edited suggestions, 0 SUGGESTED, and passing validation
    await expect(markValidated(enc1.id, billingActor)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_PREREQUISITE_MISSING',
    });

    const analysis1 = await prisma.aiAnalysis.create({
      data: {
        recordId: rec1.id,
        runBy: coderUser.id,
        extractedJson: { test: true },
        modelName: 'test-model',
        status: 'ANALYZED',
      },
    });
    tracker.aiAnalysisIds.push(analysis1.id);

    const acceptedSug = await prisma.codingSuggestion.create({
      data: {
        analysisId: analysis1.id,
        codeType: 'ICD10',
        icd10Code: icd.code,
        description: icd.description,
        supportingText: 'Supporting text',
        reason: 'Reason',
        units: 1,
        reviewStatus: 'ACCEPTED',
        reviewedBy: coderUser.id,
      },
    });
    const pendingSug = await prisma.codingSuggestion.create({
      data: {
        analysisId: analysis1.id,
        codeType: 'ICD10',
        icd10Code: icd.code,
        description: icd.description,
        supportingText: 'Pending text',
        reason: 'Reason',
        units: 1,
        reviewStatus: 'SUGGESTED',
      },
    });
    tracker.codingSuggestionIds.push(acceptedSug.id, pendingSug.id);

    const valFail = await prisma.validationResult.create({
      data: {
        encounterId: enc1.id,
        ruleType: 'CODING',
        status: 'FAILED',
        message: 'Failed check',
      },
    });
    tracker.validationResultIds.push(valFail.id);

    // Unreviewed SUGGESTED suggestion blocks markValidated
    await expect(markValidated(enc1.id, billingActor)).rejects.toMatchObject({
      statusCode: 400,
      code: 'UNREVIEWED_SUGGESTIONS_EXIST',
    });

    // Reject pending suggestion so 0 SUGGESTED remain, but FAILED validation still blocks
    await prisma.codingSuggestion.update({
      where: { id: pendingSug.id },
      data: { reviewStatus: 'REJECTED', reviewedBy: coderUser.id },
    });
    await expect(markValidated(enc1.id, billingActor)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_NOT_PASSED',
    });

    // Mid-workflow closure rejected while CODING_IN_PROGRESS
    await expect(closeEncounter(enc1.id, billingActor)).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_STATUS_TRANSITION',
    });

    // Replace FAILED row with PASSED (simulating KAN-6 revalidation) -> markValidated succeeds
    await prisma.validationResult.update({
      where: { id: valFail.id },
      data: { status: 'PASSED', message: 'Passed revalidation' },
    });
    const validated = await markValidated(enc1.id, billingActor);
    expect(validated.status).toBe('VALIDATED');

    // markClaimSubmitted blocked without SUBMITTED claim + externalRef
    const draftClaim = await prisma.claim.create({
      data: {
        encounterId: enc1.id,
        submittedBy: billingUser.id,
        formDataJson: { total: 100 },
        status: 'DRAFT',
      },
    });
    tracker.claimIds.push(draftClaim.id);

    await expect(markClaimSubmitted(enc1.id, billingActor)).rejects.toMatchObject({
      statusCode: 400,
      code: 'CLAIM_NOT_SUBMITTED',
    });

    await prisma.claim.update({
      where: { id: draftClaim.id },
      data: { status: 'SUBMITTED', externalRef: `EXT-${uniqueTag('clm')}`, submittedAt: new Date() },
    });
    const submitted = await markClaimSubmitted(enc1.id, billingActor);
    expect(submitted.status).toBe('CLAIM_SUBMITTED');

    // closeEncounter blocked while claim is non-terminal (SUBMITTED)
    await expect(closeEncounter(enc1.id, billingActor)).rejects.toMatchObject({
      statusCode: 409,
      code: 'OPEN_CLAIMS_EXIST',
    });

    // Terminal claim (PAID) allows closeEncounter
    await prisma.claim.update({
      where: { id: draftClaim.id },
      data: { status: 'PAID' },
    });
    const closed = await closeEncounter(enc1.id, billingActor);
    expect(closed.status).toBe('CLOSED');

    // Lifecycle audit logs persisted
    const lifecycleAudits = await prisma.auditLog.findMany({
      where: { entity: 'ENCOUNTER', entityId: enc1.id, action: 'ENCOUNTER_UPDATED' },
    });
    expect(lifecycleAudits.length).toBe(4);
  });
});
