# MedCodeAI — Medical Entities API & Shared Services (`KAN-17`, `KAN-18`, `KAN-19`)

> **Permissions (Deliverable 2 Table 2 & `UC-06`):** All endpoints below require `authenticate` + `authorize(ROLES.ADMIN, ROLES.BILLING_SPECIALIST, ROLES.CODER)`. `REVIEWER` and `PENDING` accounts receive `403 FORBIDDEN`.

---

## 1. Patients API (`/api/v1/patients` — `KAN-17`)
* `POST /api/v1/patients` — Body: `{ name, dob, gender, memberId }` (`dob` cannot be in the future; `memberId` is non-unique). Returns `201 Created`; logs `PATIENT_CREATED`.
* `GET /api/v1/patients` — Query: `page`, `limit` (max 100), `search` (name or memberId), `gender`.
* `GET /api/v1/patients/:id` — Returns `200` or `404 PATIENT_NOT_FOUND`.
* `PATCH /api/v1/patients/:id` — Partial update (`name`, `dob`, `gender`, `memberId`); logs `PATIENT_UPDATED`.
* `DELETE /api/v1/patients/:id` — Blocked with `409 DEPENDENT_RECORDS_EXIST` if encounters exist; otherwise deletes and logs `PATIENT_DELETED`.

---

## 2. Providers API (`/api/v1/providers` — `KAN-18`)
* `POST /api/v1/providers` — Body: `{ name, npi, specialty }` (`npi` is a 10-digit string; duplicate NPI returns `409 DUPLICATE_NPI`). Logs `PROVIDER_CREATED`.
* `GET /api/v1/providers` — Query: `page`, `limit`, `search` (name, npi, or specialty), `specialty`.
* `GET /api/v1/providers/:id` — Returns `200` or `404 PROVIDER_NOT_FOUND`.
* `PATCH /api/v1/providers/:id` — Partial update with duplicate NPI check; logs `PROVIDER_UPDATED`.
* `DELETE /api/v1/providers/:id` — Blocked with `409 DEPENDENT_RECORDS_EXIST` if encounters exist; otherwise deletes and logs `PROVIDER_DELETED`.

---

## 3. Encounters API (`/api/v1/encounters` — `KAN-19`)
* `POST /api/v1/encounters` — Body: `{ patientId, providerId, payerId, planId, encounterDate, placeOfService }`.
  * Forces initial `status = OPEN` (rejects client-supplied `status`).
  * Verifies `patient`, `provider`, `payer`, `plan` exist (`404`) and `plan.payerId === payerId` (`400 PAYER_PLAN_MISMATCH`).
  * Logs `ENCOUNTER_CREATED`.
* `GET /api/v1/encounters` — Query: `page`, `limit`, `patientId`, `providerId`, `payerId`, `status`, `startDate`, `endDate`.
* `GET /api/v1/encounters/:id` — Returns encounter with safe `patient`, `provider`, `payer`, `plan` projections.
* `PATCH /api/v1/encounters/:id` — Metadata-only (`patientId`, `providerId`, `payerId`, `planId`, `encounterDate`, `placeOfService`) while `status === 'OPEN'` and zero dependent artifacts exist (`409 ENCOUNTER_LOCKED` / `409 DEPENDENT_RECORDS_EXIST`). Generic `status` changes are rejected (`400 VALIDATION_ERROR`).
* **Workflow Transitions:** Handled internally via `EncounterService` (`startCoding`, `markValidated`, `markClaimSubmitted`, `closeEncounter`). See [encounter-lifecycle-contract.md](./encounter-lifecycle-contract.md).
* `DELETE /api/v1/encounters/:id` — Permitted per `UC-06` only when no dependent `medicalRecords`, `validationResults`, `denialRisks`, `reports`, or `claims` exist (`409 DEPENDENT_RECORDS_EXIST`).

---

## 4. Shared Teammate Service Contracts (No Internal HTTP Calls Needed)

```js
// From inside backend/src/modules/<module>/
const { getEncounterById } = require('../encounters');
const { getPatientById } = require('../patients');
const { getProviderById } = require('../providers');

// Example (KAN-5 / KAN-6 / KAN-7):
const encounter = await getEncounterById(encounterId); // Throws 404 ENCOUNTER_NOT_FOUND if missing
```
