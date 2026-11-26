# MedCodeAI — Database Integration Contracts

> **Status (Phase 4):** Initial migration (`20261125000000_init`) and synthetic seed data are deployed to `ali_dev` with Prisma Client `v6.19.3`. Teammates should apply committed migrations to their own Neon dev branches via `npm run prisma:migrate:deploy`. See [team-handover.md](./team-handover.md).

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

---

## 6. Shared Integration Interface Contracts (Implemented vs. Planned)

### Implemented Today
* **Shared Prisma Client (`backend/src/config/prisma.js`):**
  `const { prisma, checkDatabaseHealth, disconnectPrisma } = require('../../config/prisma');`
* **Shared Audit Logging Service (`backend/src/modules/audit/index.js` — `KAN-20`):**
  `const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');`
  * `await AuditService.log({ userId, action, entity, entityId, ipAddress }, { tx, bestEffort })` — Validates inputs with strict Zod schema, supports `prisma.$transaction` via `options.tx`, and propagates failures for critical actions.
  * `await AuditService.list({ page, limit, userId, action, entity, startDate, endDate })` — Paginated retrieval with safe actor fields (no `passwordHash`).
  * See [audit-logging.md](./audit-logging.md) for full action constants, transaction patterns, and teammate examples. *(Note: `GET /api/v1/audit-logs` remains unmounted until Phase 6 Auth/RBAC.)*
* **Validation Middleware (`backend/src/middleware/validate.middleware.js`):**
  `validate({ body, query, params })` using Zod schemas.
* **Response & Error Utilities (`backend/src/utils/`):**
  `sendSuccess(res, statusCode, data, meta)`, `new ApiError(statusCode, code, message, details)`, `asyncHandler(fn)`.

### Planned Interfaces (Upcoming KAN-4 Phases — Not Implemented Yet)
* **Authentication Middleware (`backend/src/middleware/auth.middleware.js` — `KAN-13`):**
  * Signature: `authenticate(req, res, next)`
  * Input: `Authorization: Bearer <jwt>` header.
  * Output: Attaches `req.user` and calls `next()`, or forwards `401 UNAUTHORIZED` (`ApiError`).
* **`req.user` Structure:**
  ```js
  {
    id: 1,                  // User.id (number)
    email: 'coder1.demo@medcodeai.local',
    role: 'CODER',          // 'ADMIN' | 'BILLING_SPECIALIST' | 'CODER' | 'REVIEWER'
    accountStatus: 'APPROVED'
  }
  ```
* **RBAC Middleware (`backend/src/middleware/rbac.middleware.js` — `KAN-14`):**
  * Signature: `authorize(...allowedRoles)` (e.g., `authorize(ROLES.CODER, ROLES.ADMIN)`)
  * Output: Calls `next()` if `req.user.accountStatus === 'APPROVED'` and `allowedRoles.includes(req.user.role)`; otherwise forwards `403 FORBIDDEN`.
* **Audit Logging Service (`backend/src/modules/audit/audit.service.js` — `KAN-20`):**
  * Signature: `await AuditService.log({ userId, action, entity, entityId = null, ipAddress = null })`
  * Output: Persists an `AuditLog` row in PostgreSQL.
* **Accepted/Edited Coding Suggestion Retrieval (Shared Query Contract):**
  * Signature: `getApprovedSuggestionsByEncounter(encounterId)`
  * Query: `prisma.codingSuggestion.findMany({ where: { analysis: { record: { encounterId } }, reviewStatus: { in: ['ACCEPTED', 'EDITED'] } }, include: { icd10: true, cpt: true, hcpcs: true, modifiers: { include: { modifier: true } } } })`
* **Encounter Access (`backend/src/modules/encounters/encounter.service.js` — `KAN-19`):**
  * Signature: `await getEncounterById(encounterId)`
  * Output: Returns `Encounter` with `patient`, `provider`, `payer`, `plan`, or throws `404 ENCOUNTER_NOT_FOUND`.
