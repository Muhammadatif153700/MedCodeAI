# MedCodeAI — Team Handover & Onboarding Guide (Milestone 1)

> **Current Implementation Status:** Express 5 skeleton (`KAN-8`), Neon PostgreSQL + Prisma 6.19.3 (`KAN-9`), 26-table schema (`KAN-10`), initial SQL migration + PostgreSQL constraints, idempotent synthetic seed (`KAN-11`), and the **Shared Audit Logging Service (`KAN-20`)** are complete. **Authentication (`KAN-12`/`KAN-13`), RBAC middleware (`KAN-14`), and CRUD APIs (`KAN-15`–`KAN-19`) are NOT implemented yet.**

---

## 1. Environment & Package Versions
* **Node.js:** `v24.19.0` (CommonJS) | **npm:** `11.17.0`
* **Core Packages:** `express@5.3.0`, `prisma@6.19.3`, `@prisma/client@6.19.3`, `zod@3.25.76`, `helmet@8.3.0`, `cors@2.8.6`, `bcryptjs@2.4.3`, `jest@29.7.0`, `supertest@7.3.2`

---

## 2. Windows Onboarding Commands (Step-by-Step)

```powershell
# 1. Clone (or update) repository and create your feature branch from dev
git clone https://github.com/Muhammadatif153700/MedCodeAI.git
cd MedCodeAI
git fetch origin
git checkout -b feature/<your-epic-branch> origin/dev

# 2. Install exact locked dependencies
cd backend
npm ci

# 3. Create your private .env (never commit this file)
copy .env.example .env
```

---

## 3. Environment Variables & How to Obtain Them
Edit `backend/.env` locally (do **not** share or commit secrets):
* `NODE_ENV=development`
* `PORT=5000`
* `CORS_ORIGINS=http://localhost:3000`
* `DATABASE_URL` & `DIRECT_URL`: In **Neon Console → Project `MedCodeAI`**, create your **own** personal development branch (e.g., `farhan_dev`, `atif_dev`, `haseeb_dev`) from `production`. Copy the **Pooled** connection string (`-pooler`) into `DATABASE_URL` and the **Direct** connection string into `DIRECT_URL` (both with `?sslmode=require`).
* `CONFIRM_DEV_SEED=true`
* `SEED_TARGET_BRANCH=<your_neon_dev_branch>`
* `SEED_APPROVED_ENDPOINTS=<your_neon_endpoint_id>` (e.g., `ep-xxxx-xxxx` from your `DIRECT_URL` hostname — `seed.js` refuses to run unless your `DATABASE_URL` endpoint matches this allowlist).
* `SEED_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD`, `SEED_PENDING_PASSWORD`: Choose your own local dev passwords (minimum 8 characters each).
* `JWT_SECRET` / `JWT_EXPIRES_IN=1h`: Required in Phase 5+ (`KAN-13`).

---

## 4. Prisma, Migrations, Seeding & Verification Commands

```powershell
cd backend
npm run prisma:generate          # Generate Prisma Client (v6.19.3)
npm run prisma:migrate:deploy    # Apply committed migrations to YOUR Neon dev branch
npm run prisma:migrate:status    # Confirm "Database schema is up to date!"
npm run db:seed                  # Run idempotent synthetic seed (safe to re-run)
npm run db:verify                # Read-only pooled + direct SELECT 1 check
npm test                         # Run Jest + Supertest suite
npm run dev                      # Start backend on http://localhost:5000
```

Verify health endpoints (in a second terminal):
```powershell
Invoke-WebRequest -Uri http://localhost:5000/api/v1/health -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:5000/api/v1/health/db -UseBasicParsing
```

---

## 5. Module-Specific Teammate Guidance

* **Shared Client:** `const { prisma } = require('../../config/prisma');`
* **API Conventions:** Base path `/api/v1`; responses use `{ success: true, data, meta? }` and `{ success: false, error: { code, message, details? } }`. See [backend-conventions.md](./backend-conventions.md) and [database-contracts.md](./database-contracts.md).

### Farhan — `KAN-5` (Medical Records & AI Coding: `src/modules/records/`, `src/modules/coding/`)
* **Models:** `prisma.medicalRecord`, `prisma.aiAnalysis`, `prisma.codingSuggestion`, `prisma.suggestionModifier`.
* **Key Enums:** `MedicalRecordStatus` (`UPLOADED`, `ANALYZING`, `ANALYZED`, `FAILED`), `AiAnalysisStatus`, `CodeType` (`ICD10`, `CPT`, `HCPCS`), `ReviewStatus` (`SUGGESTED`, `ACCEPTED`, `EDITED`, `REJECTED`).
* **Dependencies:** Reads `Encounter`, `User`, and KAN-6 code libraries (`icd10Code`, `cptCode`, `hcpcsCode`, `modifier`). Until `KAN-13`/`KAN-14` (`authenticate`/`authorize`) and `KAN-19` (`encounters`) are merged, develop against seeded `Encounter` IDs and do not bypass auth in production code.

### Atif — `KAN-6` (Payers & Validation: `src/modules/payers/`, `src/modules/validation/`)
* **Models:** `prisma.payer`, `prisma.insurancePlan`, `prisma.payerRule`, `prisma.rateReference`, `prisma.claimEditRule`, `prisma.icd10Code`, `prisma.cptCode`, `prisma.hcpcsCode`, `prisma.modifier`, `prisma.validationResult`, `prisma.denialRisk`.
* **Key Enums:** `ValidationStatus` (`PASSED`, `WARNING`, `FAILED`), `RiskLevel` (`LOW`, `MEDIUM`, `HIGH`).
* **Dependencies:** Reads KAN-5 `codingSuggestion` rows (`ACCEPTED`/`EDITED`) and `Encounter`. Note: `rate_references` non-overlapping effective-date checks must be enforced in your service layer.

### Haseeb — `KAN-7` (Claims & Reporting: `src/modules/claims/`, `src/modules/reports/`)
* **Models:** `prisma.report`, `prisma.claim`, `prisma.claimStatusHistory`.
* **Key Enums:** `ReportStatus` (`GENERATED`, `EXPORTED`), `ClaimStatus` (`DRAFT`, `VALIDATED`, `READY`, `SUBMITTED`, `IN_PROCESS`, `PENDING_INFO`, `REJECTED`, `CORRECTED`, `RESUBMITTED`, `ACCEPTED`, `PAID`, `DENIED`, `APPEALED`, `CLOSED`).
* **Dependencies:** Reads `Encounter`, `Patient`, `Provider`, `Payer`, `InsurancePlan`, and KAN-6 `ValidationResult`/`DenialRisk` before allowing claim submission.

---

## 6. Migration Ownership & Git Rules
* **Only KAN-4 (Ali)** modifies `prisma/schema.prisma` and generates new migrations. Teammates run `npm run prisma:migrate:deploy` after pulling from `dev`.
* Never commit directly to `main` or `dev`, never push `.env`, and use strictly synthetic/de-identified data.
