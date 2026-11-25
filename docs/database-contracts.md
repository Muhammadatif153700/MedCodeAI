# MedCodeAI — Database Integration Contracts

> **Status (Phase 3):** Prisma schema is validated and Prisma Client (`v6.19.3`) is generated locally. **Migrations and seed data will be applied in Phase 4 (`KAN-11`).**

---

## 1. Shared Prisma Client Import Path

All backend modules must import the shared singleton from:

```js
const { prisma } = require('../../config/prisma');
```

Never instantiate `new PrismaClient()` inside controllers, services, or routes.

---

## 2. Exact Prisma Client Model Accessors

| Module Owner | Prisma Accessor (`prisma.<name>`) | Key Fields & Foreign Keys |
| :--- | :--- | :--- |
| **KAN-4 (Ali)** | `prisma.role`, `prisma.user`, `prisma.auditLog`, `prisma.patient`, `prisma.provider`, `prisma.encounter` | `User(email, roleId, isActive, accountStatus)`, `AuditLog(userId, action, entity, entityId)`, `Encounter(patientId, providerId, payerId, planId, encounterDate, placeOfService, status)` |
| **KAN-5 (Farhan)** | `prisma.medicalRecord`, `prisma.aiAnalysis`, `prisma.codingSuggestion`, `prisma.suggestionModifier` | `MedicalRecord(encounterId, uploadedBy, filePath, fileType, status, createdAt)`, `AiAnalysis(recordId, runBy, extractedJson, modelName, status)`, `CodingSuggestion(analysisId, codeType, icd10Code, cptCode, hcpcsCode, units, reviewStatus, reviewedBy, reviewComment)`, `SuggestionModifier(suggestionId, modifierCode, reviewStatus)` |
| **KAN-6 (Atif)** | `prisma.payer`, `prisma.insurancePlan`, `prisma.payerRule`, `prisma.rateReference`, `prisma.claimEditRule`, `prisma.icd10Code`, `prisma.cptCode`, `prisma.hcpcsCode`, `prisma.modifier`, `prisma.validationResult`, `prisma.denialRisk` | `InsurancePlan(payerId, name, authRequired)`, `PayerRule(payerId, planId?, ruleType, ruleJson, effectiveDate)`, `RateReference(payerId, code, placeOfService, geoArea, rate, effectiveDate)`, `ClaimEditRule(ruleType, codeA, codeB, action)`, `ValidationResult(encounterId, ruleType, status, message, modelVersion)`, `DenialRisk(encounterId, issue, riskLevel, recommendedAction)` |
| **KAN-7 (Haseeb)** | `prisma.report`, `prisma.claim`, `prisma.claimStatusHistory` | `Report(encounterId, generatedBy, contentJson, status)`, `Claim(encounterId, submittedBy?, formDataJson, status, submittedAt?, externalRef?)`, `ClaimStatusHistory(claimId, status, note?, followUpDate?, changedAt)` |
| **Open Decision** | `prisma.chatSession`, `prisma.chatMessage` | `ChatSession(userId, createdAt)`, `ChatMessage(sessionId, sender, content, createdAt)` |

---

## 3. Shared Enum Values

All modules must use these exact Prisma enum strings:

* **`AccountApprovalStatus`:** `PENDING`, `APPROVED`, `REJECTED`
* **`EncounterStatus`:** `OPEN`, `CODING_IN_PROGRESS`, `VALIDATED`, `CLAIM_SUBMITTED`, `CLOSED`
* **`MedicalRecordStatus`:** `UPLOADED`, `ANALYZING`, `ANALYZED`, `FAILED`
* **`AiAnalysisStatus`:** `ANALYZING`, `ANALYZED`, `FAILED`
* **`CodeType`:** `ICD10`, `CPT`, `HCPCS`
* **`ReviewStatus`:** `SUGGESTED`, `ACCEPTED`, `EDITED`, `REJECTED`
* **`ValidationStatus`:** `PASSED`, `WARNING`, `FAILED`
* **`RiskLevel`:** `LOW`, `MEDIUM`, `HIGH`
* **`ReportStatus`:** `GENERATED`, `EXPORTED`
* **`ClaimStatus`:** `DRAFT`, `VALIDATED`, `READY`, `SUBMITTED`, `IN_PROCESS`, `PENDING_INFO`, `REJECTED`, `CORRECTED`, `RESUBMITTED`, `ACCEPTED`, `PAID`, `DENIED`, `APPEALED`, `CLOSED`
* **`ChatSender`:** `USER`, `ASSISTANT`

---

## 4. Cross-Module Dependencies & Example Queries

* **KAN-4 → All:** Provides `User` (auth/RBAC), `Encounter`, `Patient`, `Provider`, and `AuditLog`.
* **KAN-5 → KAN-6:** `CodingSuggestion` rows with `reviewStatus: 'ACCEPTED'` or `'EDITED'` feed `ValidationResult` & `DenialRisk`.
* **KAN-6 → KAN-4/5/7:** `Payer` and `InsurancePlan` are required FKs on `Encounter`; `ValidationResult` & `DenialRisk` gate `Claim` submission (`SEQ-6`).

### Farhan (`KAN-5`) — Fetch Accepted/Suggested Codes for an Analysis
```js
const suggestions = await prisma.codingSuggestion.findMany({
  where: { analysisId, reviewStatus: { in: ['ACCEPTED', 'EDITED'] } },
  include: { icd10: true, cpt: true, hcpcs: true, modifiers: { include: { modifier: true } } },
});
```

### Atif (`KAN-6`) — Load Payer Rules & Rate Reference
```js
const rules = await prisma.payerRule.findMany({
  where: { payerId, OR: [{ planId }, { planId: null }] },
});
const rate = await prisma.rateReference.findFirst({
  where: { payerId, code, placeOfService, geoArea, effectiveDate: { lte: encounterDate } },
  orderBy: { effectiveDate: 'desc' },
});
```

### Haseeb (`KAN-7`) — Auto-fill Claim from Encounter & Validation
```js
const encounter = await prisma.encounter.findUnique({
  where: { id: encounterId },
  include: { patient: true, provider: true, payer: true, plan: true, validationResults: true },
});
```

---

## 5. Migration Ownership & Safe Development Practices

* **Schema Owner (`KAN-4`):** Only Ali modifies `schema.prisma` and runs `npx prisma migrate dev` on `ali_dev`.
* **Teammates (`KAN-5`, `KAN-6`, `KAN-7`):** Pull migrations from `dev` and run `npx prisma migrate deploy` on their own Neon dev branch.
* **Safety Rules:** Never run migrations or tests against `production`; use strictly synthetic/de-identified data; never commit `.env` or credentials.
