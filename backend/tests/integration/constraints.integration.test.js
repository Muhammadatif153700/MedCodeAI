const {
  prisma,
  disconnectPrisma,
  uniqueTag,
  uniqueNpi,
  createTracker,
  cleanupTracked,
  createSyntheticUser,
} = require('./helpers');

describe('Integration: PostgreSQL Constraints & Integrity (Real PostgreSQL)', () => {
  const tracker = createTracker();

  afterEach(async () => {
    await cleanupTracked(tracker);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  test('Enforces all 5 custom PostgreSQL constraints directly at the DB layer', async () => {
    const { user } = await createSyntheticUser(tracker, 'CODER');
    const patient = await prisma.patient.findFirst();
    const provider = await prisma.provider.findFirst();
    const payers = await prisma.payer.findMany({ include: { insurancePlans: true }, take: 2 });
    const icd = await prisma.icd10Code.findFirst();
    const cpt = await prisma.cptCode.findFirst();

    const plan = payers[0].insurancePlans[0];
    const enc = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        providerId: provider.id,
        payerId: payers[0].id,
        planId: plan.id,
        encounterDate: new Date('2026-10-03'),
        placeOfService: '11',
        status: 'OPEN',
      },
    });
    tracker.encounterIds.push(enc.id);

    const record = await prisma.medicalRecord.create({
      data: {
        encounterId: enc.id,
        uploadedBy: user.id,
        filePath: `/synthetic/${uniqueTag('rec')}.pdf`,
        fileType: 'application/pdf',
      },
    });
    tracker.medicalRecordIds.push(record.id);

    const analysis = await prisma.aiAnalysis.create({
      data: {
        recordId: record.id,
        runBy: user.id,
        extractedJson: { note: 'synthetic' },
        modelName: 'test-model',
        status: 'ANALYZED',
      },
    });
    tracker.aiAnalysisIds.push(analysis.id);

    // 1. coding_suggestions_code_reference_check (ICD10 with cptCode set -> rejected)
    await expect(
      prisma.codingSuggestion.create({
        data: {
          analysisId: analysis.id,
          codeType: 'ICD10',
          icd10Code: icd.code,
          cptCode: cpt.code,
          description: 'Invalid cross-code ref',
          supportingText: 'text',
          reason: 'test',
          units: 1,
        },
      })
    ).rejects.toThrow(/coding_suggestions_code_reference_check|23514/);

    // 2. coding_suggestions_units_positive (units <= 0 -> rejected)
    await expect(
      prisma.codingSuggestion.create({
        data: {
          analysisId: analysis.id,
          codeType: 'ICD10',
          icd10Code: icd.code,
          description: 'Zero units',
          supportingText: 'text',
          reason: 'test',
          units: 0,
        },
      })
    ).rejects.toThrow(/coding_suggestions_units_positive|23514/);

    // 3. encounters_plan_payer_fkey (mismatched planId and payerId -> rejected)
    const otherPayerPlan = payers[1].insurancePlans[0];
    await expect(
      prisma.encounter.create({
        data: {
          patientId: patient.id,
          providerId: provider.id,
          payerId: payers[0].id,
          planId: otherPayerPlan.id,
          encounterDate: new Date('2026-10-03'),
          placeOfService: '11',
        },
      })
    ).rejects.toThrow(/encounters_plan_payer_fkey|P2003|23503/);

    // 4. rate_references_rate_non_negative (negative rate -> rejected)
    await expect(
      prisma.rateReference.create({
        data: {
          payerId: payers[0].id,
          code: cpt.code,
          placeOfService: '11',
          geoArea: '00',
          rate: -10.5,
          effectiveDate: new Date('2026-01-01'),
        },
      })
    ).rejects.toThrow(/rate_references_rate_non_negative|23514/);

    // 5. users_approved_requires_role (APPROVED user with null roleId -> rejected)
    await expect(
      prisma.user.create({
        data: {
          name: 'Invalid Approved User',
          email: `${uniqueTag('badusr')}@medcodeai.test`,
          passwordHash: 'hash',
          accountStatus: 'APPROVED',
          roleId: null,
        },
      })
    ).rejects.toThrow(/users_approved_requires_role|23514/);
  });

  test('Enforces unique email/NPI, FK constraints, NOT NULL, nullable audit userId, ON DELETE RESTRICT, and token_version default 0', async () => {
    const tag = uniqueTag('pg');
    const { user } = await createSyntheticUser(tracker, 'CODER');
    expect(user.tokenVersion).toBe(0);

    // Duplicate email
    await expect(
      prisma.user.create({
        data: {
          name: 'Dup Email',
          email: user.email,
          passwordHash: 'hash',
          accountStatus: 'PENDING',
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    // Duplicate NPI
    const npi = uniqueNpi();
    const prov = await prisma.provider.create({
      data: { name: `Prov ${tag}`, npi, specialty: 'Internal' },
    });
    tracker.providerIds.push(prov.id);

    await expect(
      prisma.provider.create({
        data: { name: 'Dup Prov', npi, specialty: 'Internal' },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    // Invalid FK
    await expect(
      prisma.encounter.create({
        data: {
          patientId: 99999999,
          providerId: prov.id,
          payerId: 1,
          planId: 1,
          encounterDate: new Date('2026-10-03'),
          placeOfService: '11',
        },
      })
    ).rejects.toMatchObject({ code: 'P2003' });

    // Nullable audit_logs.user_id works
    const nullAudit = await prisma.auditLog.create({
      data: { userId: null, action: 'USER_LOGIN_FAILED', entity: 'User', entityId: null },
    });
    tracker.auditLogIds.push(nullAudit.id);
    expect(nullAudit.userId).toBeNull();

    // ON DELETE RESTRICT prevents deleting a User that still has AuditLog rows
    const userAudit = await prisma.auditLog.create({
      data: { userId: user.id, action: 'USER_LOGIN_SUCCESS', entity: 'User', entityId: user.id },
    });
    tracker.auditLogIds.push(userAudit.id);

    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });
});
