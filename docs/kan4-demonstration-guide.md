# MedCodeAI — KAN-4 Backend API Demonstration Guide (5–10 Minute Walkthrough)

## 1. Prerequisites & Startup

1. Configure `backend/.env` (development) or `backend/.env.test` (isolated test branch `ali_integration_test` / `medcodeai_test`) with:
   - `NODE_ENV` (`development` or `test`)
   - `PORT` (default `5000` in dev, `5001` in `.env.test`)
   - `DATABASE_URL` (Neon `-pooler` URL) and `DIRECT_URL` (Neon direct URL)
   - `JWT_SECRET` (at least 32 characters; enforced at startup by `src/config/env.js` and `src/server.js`)
2. Start the backend:
   ```powershell
   cd backend
   npm run dev   # or npm start
   ```
3. Open **Swagger UI** in your browser (enabled in `development`/`test`, disabled in `production` by default):
   - UI: `http://localhost:5000/api-docs`
   - Raw OpenAPI JSON: `http://localhost:5000/api-docs/openapi.json`

---

## 2. Postman Setup

1. Import `postman/MedCodeAI-KAN4.postman_collection.json`.
2. Import `postman/MedCodeAI-Local.postman_environment.json`.
3. Fill in `adminPassword` and `staffPassword` locally in Postman (never commit secrets).
4. Ensure `baseUrl` matches your running server (e.g. `http://localhost:5000/api/v1`).

---

## 3. Live 5–10 Minute Demonstration Script

1. **Health & DB Readiness (`00 — Health Checks`):**
   - `GET /api/v1/health` -> `200` (`status: "ok"`).
   - `GET /api/v1/health/db` -> `200` (`database: "connected"`).
2. **Public Registration & Pending Gate (`10 — End-to-End Demonstration` steps 3–4):**
   - `POST /api/v1/auth/register` -> `201`, `accountStatus: "PENDING"`, `role: null` (no JWT issued).
   - Attempt `POST /api/v1/auth/login` -> `403 ACCOUNT_PENDING_APPROVAL`.
3. **Administrator Approval & RBAC (`steps 5–8`):**
   - `POST /api/v1/auth/login` as Admin (`admin.demo@medcodeai.local`) -> `200` (captures `adminToken` with `tv` claim).
   - `GET /api/v1/users/pending` -> shows newly registered user.
   - `PATCH /api/v1/users/:id/approve` with `{ "role": "CODER" }` -> `200`.
   - `POST /api/v1/auth/login` as the newly approved user -> `200`.
4. **Self-Service Profile & Medical Entities (`steps 9–17`):**
   - `GET /api/v1/profile` & `PATCH /api/v1/profile` -> `200`.
   - `POST /api/v1/patients` -> `201`.
   - `POST /api/v1/providers` (10-digit string NPI preserving leading zeros) -> `201`.
   - `POST /api/v1/encounters` (using verified `payerId` & `planId`) -> `201`, `status: "OPEN"`.
   - `PATCH /api/v1/encounters/:id` with `{ "placeOfService": "23" }` -> `200`.
   - `PATCH /api/v1/encounters/:id` with `{ "status": "CLAIM_SUBMITTED" }` -> `400` (generic status bypass blocked; transitions require `EncounterService` prerequisite checks).
   - `GET /api/v1/users` using the `CODER` token -> `403 FORBIDDEN`.
5. **JWT Revocation on Password Change (`steps 18–20`):**
   - `PATCH /api/v1/profile/password` -> increments `users.token_version` in PostgreSQL (`0 -> 1`).
   - Re-call `GET /api/v1/auth/me` with the old JWT -> `401` (immediately revoked, even before `exp`).
   - Log in with the new password -> `200` with `tv: 1`.
6. **Audit Trail & Cleanup (`steps 21–24`):**
   - `GET /api/v1/audit-logs` as Admin -> shows `USER_REGISTERED`, `USER_ACCOUNT_APPROVED`, `ENCOUNTER_CREATED`, `USER_PASSWORD_CHANGED`, etc., with zero passwords/JWTs.
   - Delete demo encounter, patient, and provider cleanly.

---

## 4. Explaining Reliability & Security Guarantees

- **PostgreSQL Persistence & Constraints:** 26 tables, 5 custom constraints (`coding_suggestions_code_reference_check`, `coding_suggestions_units_positive`, `encounters_plan_payer_fkey`, `rate_references_rate_non_negative`, `users_approved_requires_role`), verified by real PostgreSQL tests (`npm --prefix backend run test:integration`).
- **Transaction Rollback:** Mutations and `AuditService.log(..., { tx })` execute atomically; any audit or constraint failure rolls back the business write.
- **Concurrency:** `Serializable` transactions prevent double password changes, concurrent admin self/last-admin lockouts, and duplicate `startCoding` transitions.

---

## 5. Troubleshooting & Known Limitations

- **Server fails at startup with `JWT_SECRET must be at least 32 characters`:** Set a 32+ char `JWT_SECRET` in `.env` / `.env.test`.
- **Outstanding Items:**
  - Existing-data migration upgrade test (`20261125000000_init` -> `20261127000000_phase9b_security_hardening`) remains pending on a separate disposable logical database.
  - `KAN-6` routes (`/payers/*`, `/validation/*`) remain unauthenticated (`F-03`, Atif's scope).
  - Validation freshness across coding edits depends on `KAN-6` replacing prior `ValidationResult` rows inside its revalidation transaction.
  - Runtime `zod` advisory remains deferred (requires v4 major upgrade).
  - Intentional composite FK Prisma drift (`encounters_plan_payer_fkey`) remains documented.
