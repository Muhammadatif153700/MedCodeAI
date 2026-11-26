const fs = require('fs');
const path = require('path');
const {
  PrismaClient,
  AccountApprovalStatus,
  MedicalRecordStatus,
  ReviewStatus,
  ClaimStatus,
  CodeType,
  RiskLevel,
} = require('@prisma/client');

describe('Prisma Schema Contract Verification (Phase 3 / KAN-10)', () => {
  test('Exposes all 26 expected ERD model accessors on PrismaClient', () => {
    const client = new PrismaClient();
    const expectedDelegates = [
      'role',
      'user',
      'auditLog',
      'patient',
      'provider',
      'encounter',
      'medicalRecord',
      'aiAnalysis',
      'codingSuggestion',
      'suggestionModifier',
      'icd10Code',
      'cptCode',
      'hcpcsCode',
      'modifier',
      'payer',
      'insurancePlan',
      'payerRule',
      'rateReference',
      'claimEditRule',
      'validationResult',
      'denialRisk',
      'report',
      'claim',
      'claimStatusHistory',
      'chatSession',
      'chatMessage',
    ];

    expect(expectedDelegates).toHaveLength(26);
    for (const delegate of expectedDelegates) {
      expect(client[delegate]).toBeDefined();
      expect(typeof client[delegate].findMany).toBe('function');
    }
  });

  test('Exposes shared workflow and status enums matching requirements', () => {
    expect(Object.values(AccountApprovalStatus)).toEqual([
      'PENDING',
      'APPROVED',
      'REJECTED',
    ]);
    expect(Object.values(MedicalRecordStatus)).toEqual([
      'UPLOADED',
      'ANALYZING',
      'ANALYZED',
      'FAILED',
    ]);
    expect(Object.values(ReviewStatus)).toEqual([
      'SUGGESTED',
      'ACCEPTED',
      'EDITED',
      'REJECTED',
    ]);
    expect(Object.values(ClaimStatus)).toEqual([
      'DRAFT',
      'VALIDATED',
      'READY',
      'SUBMITTED',
      'IN_PROCESS',
      'PENDING_INFO',
      'REJECTED',
      'CORRECTED',
      'RESUBMITTED',
      'ACCEPTED',
      'PAID',
      'DENIED',
      'APPEALED',
      'CLOSED',
    ]);
    expect(Object.values(CodeType)).toEqual(['ICD10', 'CPT', 'HCPCS']);
    expect(Object.values(RiskLevel)).toEqual(['LOW', 'MEDIUM', 'HIGH']);
  });

  test('Initial SQL migration defines all 26 tables, PostgreSQL constraints, and no DROP statements', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../prisma/migrations/20261125000000_init/migration.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect((sql.match(/CREATE TABLE "/g) || [])).toHaveLength(26);
    expect(sql).toContain('coding_suggestions_units_positive');
    expect(sql).toContain('coding_suggestions_code_reference_check');
    expect(sql).toContain('rate_references_rate_non_negative');
    expect(sql).toContain('encounters_plan_payer_fkey');
    expect(sql).toContain('users_approved_requires_role');
  });
});
