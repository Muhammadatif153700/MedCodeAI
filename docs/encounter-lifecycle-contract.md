# MedCodeAI — Encounter Lifecycle & Teammate Integration Contract (`Phase 9B`)

> **Policy:** Generic `PATCH /api/v1/encounters/:id` no longer accepts `status` and blocks metadata edits once `status !== 'OPEN'` or dependent workflow artifacts exist (`409 ENCOUNTER_LOCKED` / `409 DEPENDENT_RECORDS_EXIST`). All workflow transitions must go through `EncounterService`'s internal transaction-safe methods below.

---

## 1. Exact Import Path

```js
const {
  getEncounterById,
  startCoding,
  markValidated,
  markClaimSubmitted,
  closeEncounter,
} = require('../encounters');
```

---

## 2. Internal Transition Signatures & Prerequisites

All transition functions accept `(encounterId, actor, options = {})` where:
* `actor`: `{ userId: req.user.id, role: req.user.role, ipAddress: req.ip }`
* `options.tx` (optional): Caller-supplied Prisma transaction client (`tx`). If omitted, the method opens a `Serializable` transaction automatically (no nested `$transaction`).

| Function | Allowed Roles | Transition | Mandatory DB Prerequisites | Error Codes |
| :--- | :--- | :--- | :--- | :--- |
| `startCoding(id, actor, opts)` | `CODER`, `ADMIN` | `OPEN → CODING_IN_PROGRESS` | ≥ 1 `MedicalRecord` for `encounterId` | `403 FORBIDDEN`, `400 CODING_PREREQUISITE_MISSING`, `409 CONCURRENT_MODIFICATION` |
| `markValidated(id, actor, opts)` | `BILLING_SPECIALIST`, `CODER`, `ADMIN` | `CODING_IN_PROGRESS → VALIDATED` | ≥ 1 `CodingSuggestion` (`ACCEPTED`/`EDITED`), `0` `CodingSuggestion` with `reviewStatus = 'SUGGESTED'`, AND ≥ 1 `ValidationResult` with `0` `FAILED` rows | `400 VALIDATION_PREREQUISITE_MISSING`, `400 UNREVIEWED_SUGGESTIONS_EXIST`, `400 VALIDATION_NOT_PASSED` |
| `markClaimSubmitted(id, actor, opts)` | `BILLING_SPECIALIST` | `VALIDATED → CLAIM_SUBMITTED` | ≥ 1 `Claim` with `status IN ('SUBMITTED','IN_PROCESS','ACCEPTED','PAID','RESUBMITTED')` AND non-null `externalRef` | `400 CLAIM_NOT_SUBMITTED` |
| `closeEncounter(id, actor, opts)` | `ADMIN`, `BILLING_SPECIALIST` | `OPEN → CLOSED` (`ADMIN` only, 0 dependents) OR `CLAIM_SUBMITTED → CLOSED` | `OPEN → CLOSED` requires `ADMIN` and 0 dependent records/claims; `CLAIM_SUBMITTED → CLOSED` requires all claims `PAID`, `DENIED`, or `CLOSED`; `CODING_IN_PROGRESS`/`VALIDATED`/`CLOSED` cannot be closed directly | `400 INVALID_STATUS_TRANSITION`, `403 FORBIDDEN`, `409 DEPENDENT_RECORDS_EXIST`, `409 OPEN_CLAIMS_EXIST` |

> **Important (`KAN-6` Revalidation Responsibility):** Because `ValidationResult` has no `createdAt` or `runId` column in the shared schema, `markValidated()` fails closed whenever any `FAILED` `ValidationResult` row exists for the encounter. When `KAN-6` re-runs validation after fixing coding errors, it **must** clear or replace prior `ValidationResult` rows for that encounter inside the same transaction before calling `markValidated()`.

---

## 3. Teammate Integration Examples

```js
// Farhan (KAN-5): After saving MedicalRecord inside prisma.$transaction(async (tx) => { ... })
await startCoding(encounterId, { userId: req.user.id, role: req.user.role, ipAddress: req.ip }, { tx });

// Atif (KAN-6): After saving passing ValidationResult rows inside tx
await markValidated(encounterId, { userId: req.user.id, role: req.user.role, ipAddress: req.ip }, { tx });

// Haseeb (KAN-7): After Mock Payer returns externalRef and Claim is updated to SUBMITTED inside tx
await markClaimSubmitted(encounterId, { userId: req.user.id, role: req.user.role, ipAddress: req.ip }, { tx });
```
