# MedCodeAI — KAN-6 Non-Destructive Compatibility Repair Report (`Milestone 3 Part 2A`)

> **Goal:** Restore Express startup, shared RBAC/Prisma/env/AuditService compatibility, and `EncounterService` lifecycle integration after merging `origin/dev` (`d59e986`), while preserving 100% of Atif's `KAN-6` endpoints, role lists, and business logic.

---

## 1. Original Defects & Root Causes

| # | File | Root Cause | Impact |
| :--- | :--- | :--- | :--- |
| 1 | `payers.routes.js`, `validation.routes.js` | Passed `authorize([ROLES.ADMIN, ...])` array instead of variadic `authorize(ROLES.ADMIN, ...)` | App crashed on boot: `Invalid role configured in authorize(): ADMIN,CODER` |
| 2 | `payers.controller.js`, `validation.routes.js`, `validation.service.js` | `const prisma = require('../../config/prisma')` instead of `const { prisma } = ...` | `prisma.<model>` was `undefined` at runtime |
| 3 | `validation.service.js` | `const env = require('../../config/env')` instead of `const { env } = ...`, plus `ML_API_URL` absent from `envSchema` | `env.ML_API_URL` read `undefined`; no URL/timeout validation |
| 4 | `payers.controller.js` | `AuditService.log(req.user.id, AUDIT_ACTIONS.CREATE, AUDIT_ENTITIES.ICD10, code.id)` | Positional args & undefined constants (`CREATE`, `ICD10`, `CPT`) + non-atomic writes |
| 5 | `payers.routes.js`, `validation.routes.js` | Inline `validate` middleware bypassing shared `ApiError` handler | Validation errors bypassed standard `{ success: false, error }` envelope |
| 6 | `validation.routes.js`, `validation.service.js` | No transaction wrapper around DB writes & no `EncounterService.markValidated()` integration | Non-atomic validation/denial-risk writes & encounter status not transitioned |

---

## 2. Exact Fixes Applied

1. **`backend/src/modules/payers/payers.routes.js` & `backend/src/modules/validation/validation.routes.js`:**
   - Converted all `authorize([...])` calls to variadic `authorize(...)` preserving every endpoint's exact intended roles.
   - Switched to shared `validate` middleware (`../../middleware/validate.middleware`) and `asyncHandler`.
2. **`backend/src/modules/payers/payers.controller.js`, `validation.routes.js`, `validation.service.js`:**
   - Switched to `const { prisma } = require('../../config/prisma');`.
   - Switched to `const { env } = require('../../config/env');`.
3. **`backend/src/config/env.js`, `backend/.env.example`, `backend/.env.test.example`:**
   - Added optional validated `ML_API_URL` (`http://`/`https://` when set) and `ML_API_TIMEOUT_MS` (default `10000`, `500..60000`). Missing `ML_API_URL` does not block server startup.
4. **`backend/src/modules/payers/payers.controller.js`:**
   - Wrapped mutations in `prisma.$transaction` with object-based `AuditService.log({ userId, action, entity, entityId, ipAddress }, { tx })` using `CODE_LIBRARY_UPDATED` (`entityId: null` for string PKs), `PAYER_RULE_CREATED`, and `RATE_REFERENCE_CREATED`.
5. **`backend/src/modules/validation/validation.service.js` & `validation.routes.js`:**
   - Added `timeout: env.ML_API_TIMEOUT_MS` and response-shape validation (`502 ML_INVALID_RESPONSE`, `503 ML_SERVICE_UNAVAILABLE` / `ML_SERVICE_FAILED`), executing external ML HTTP calls **outside** DB transactions.
   - Wrapped `validateClaim`, `analyzeDenialRisk`, `getReimbursementEstimate`, `AuditService.log(CLAIM_VALIDATED)`, and conditional `markValidated()` inside a `Serializable` transaction (`markValidated` runs only when `encounter.status === 'CODING_IN_PROGRESS'`, `validation.overallStatus !== 'FAILED'`, `acceptedSuggestions >= 1`, `pendingSuggestions === 0`, and `failedValidations === 0`).

---

## 3. Functionality Preservation Matrix (`KAN-6`)

| Module / Feature | Preserved Endpoints / Functions | Status |
| :--- | :--- | :--- |
| ICD-10 Code Library | `GET /api/v1/payers/icd10`, `POST /api/v1/payers/icd10` | Preserved + Auth/RBAC/Audit |
| CPT Code Library | `GET /api/v1/payers/cpt`, `POST /api/v1/payers/cpt` | Preserved + Auth/RBAC/Audit |
| Modifiers | `GET /api/v1/payers/modifiers` | Preserved + Auth/RBAC |
| Payer Rules | `GET /api/v1/payers/rules/:payerId`, `POST /api/v1/payers/rules` | Preserved + Auth/RBAC/Audit |
| Claim Edit Rules | `GET /api/v1/payers/claim-edits` | Preserved + Auth/RBAC |
| Rate References | `GET /api/v1/payers/rates`, `POST /api/v1/payers/rates` | Preserved + Auth/RBAC/Audit |
| Encounter Validation & ML | `POST /api/v1/validation/process-encounter` (`analyzeMedicalText`, `validateClaim`, `analyzeDenialRisk`, `getReimbursementEstimate`) | Preserved + Auth/RBAC/Tx/Lifecycle |

---

## 4. Remaining Limitations & Teammate Review Items
- **Real Python ML Service:** Not executed against a live Python ML server (`ML_API_URL` is tested with mocked `axios` responses; real ML verification requires Atif's running ML service).
- **Validation History / Freshness:** Existing `ValidationResult` rows are preserved append-only (no schema change or silent deletion). `validation.routes.js` now verifies a pre-ML coding snapshot (`409 CONCURRENT_MODIFICATION` if coding changes mid-flight). See [validation-freshness-review.md](./validation-freshness-review.md) and [kan6-api-contract.md](./kan6-api-contract.md).
- **Dependencies:** Runtime `zod` (`3.25.76`) & `prisma` (`6.19.3`) major upgrades and dev-only `newman` advisories remain documented in [dependency-security-remediation.md](./dependency-security-remediation.md).
