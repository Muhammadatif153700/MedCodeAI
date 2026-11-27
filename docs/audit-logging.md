# MedCodeAI — Shared Audit Logging Guide (KAN-20)

> **Status (Phase 6):** `AuditService`, `AUDIT_ACTIONS`, `AUDIT_ENTITIES`, and the Administrator-only endpoint `GET /api/v1/audit-logs` (protected by `authenticate` + `authorize(ROLES.ADMIN)`) are active.

---

## 1. Exact Shared Import Paths

From inside `backend/src/modules/<your-module>/`:

```js
const {
  AuditService,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
} = require('../audit');
```

---

## 2. Public API

### `AuditService.log(payload, options)`
* **Parameters:**
  * `payload.userId` (`number`, required, positive integer) — Actor `User.id`
  * `payload.action` (`string`, required) — Must be a value from `AUDIT_ACTIONS`
  * `payload.entity` (`string`, required) — Must be a value from `AUDIT_ENTITIES`
  * `payload.entityId` (`number | null`, optional) — Positive integer PK of the target entity
  * `payload.ipAddress` (`string | null`, optional) — Sanitized IPv4/IPv6 (invalid strings/headers become `null`)
  * `options.tx` (optional) — Prisma transaction client (`tx`) from `prisma.$transaction(...)`
  * `options.bestEffort` (`boolean`, optional, default `false`) — Only applies to non-critical actions; **critical security actions (`CRITICAL_AUDIT_ACTIONS`) always propagate persistence failures**
* **Strictness:** Uses Zod `.strict()`. Passing extra keys (`password`, `token`, `body`, `clinicalText`, etc.) throws `400 INVALID_AUDIT_INPUT`.
* **Returns:** Created `AuditLog` record (`{ id, userId, action, entity, entityId, ipAddress, timestamp }`).

### `AuditService.list(query)`
* **Parameters:** `{ page, limit, userId, action, entity, startDate, endDate }` (`limit` max `100`, default `20`).
* **Returns:** `{ items, meta: { page, limit, total, totalPages } }` ordered newest-first (`timestamp DESC, id DESC`) with safe actor fields (`id`, `name`, `email`, `role` — never `passwordHash`).

---

## 3. Transaction Usage & Failure Handling

### Inside `prisma.$transaction()` (Recommended for State Changes)
```js
const { prisma } = require('../../config/prisma');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');

// Example (planned KAN-4 / KAN-7 pattern):
await prisma.$transaction(async (tx) => {
  const updated = await tx.user.update({ where: { id: userId }, data: { roleId } });
  await AuditService.log(
    {
      userId: adminId,
      action: AUDIT_ACTIONS.USER_ROLE_ASSIGNED,
      entity: AUDIT_ENTITIES.USER,
      entityId: updated.id,
      ipAddress: req.ip,
    },
    { tx }
  );
  return updated;
});
```
If either the business write or `AuditService.log` fails, PostgreSQL rolls back the entire transaction—preventing partial state changes or duplicate audit records.

### Outside a Transaction
```js
await AuditService.log({
  userId: req.user.id,
  action: AUDIT_ACTIONS.USER_LOGIN_SUCCESS,
  entity: AUDIT_ENTITIES.USER,
  entityId: req.user.id,
  ipAddress: req.ip,
});
```

---

## 4. Schema Limitations & Privacy Rules
* **Schema Updates (`Phase 9B`):**
  1. `audit_logs.user_id` is nullable (`Int?`) specifically for unauthenticated `USER_LOGIN_FAILED` events (`ALLOW_NULL_ACTOR_ACTIONS`); all business mutations still require a positive integer `userId` (`null` is rejected with `400 INVALID_AUDIT_INPUT`).
  2. `audit_logs.entity_id` is `Int?`, so string-PK code libraries (`icd10_codes`, `cpt_codes`, `hcpcs_codes`, `modifiers`) should pass `entity: AUDIT_ENTITIES.CODE_LIBRARY` with `entityId: null`.
* **DoS & Retention:** Failed-login DB writes are protected by `authRateLimiter` (`AUTH_RATE_LIMIT_MAX=20` per 15 min); archive/prune aged `USER_LOGIN_FAILED` rows periodically in production.
* **Privacy:** Never pass plaintext passwords, attempted emails/passwords, hashes, JWTs, headers, DB URLs, request bodies, clinical text, or PHI into `AuditService.log()`. Audit logs are strictly append-only (no update/delete methods or routes).

---

## 5. Planned Integration Examples (Illustrative Only)

> **Note:** The business endpoints/services below are **not implemented yet**; these snippets show how each teammate will call `AuditService.log()` once their modules are built.

* **KAN-4 (User Management):** `AUDIT_ACTIONS.USER_ROLE_ASSIGNED` / `USER_ACCOUNT_APPROVED` on `AUDIT_ENTITIES.USER`.
* **KAN-5 (Farhan — Records & Coding Review):** `AUDIT_ACTIONS.RECORD_UPLOADED` on `AUDIT_ENTITIES.MEDICAL_RECORD`; `AUDIT_ACTIONS.CODING_SUGGESTION_ACCEPTED` / `EDITED` / `REJECTED` on `AUDIT_ENTITIES.CODING_SUGGESTION`.
* **KAN-6 (Atif — Payer Rules & Validation):** `AUDIT_ACTIONS.PAYER_RULE_CREATED` on `AUDIT_ENTITIES.PAYER_RULE`; `AUDIT_ACTIONS.CLAIM_VALIDATED` on `AUDIT_ENTITIES.ENCOUNTER`.
* **KAN-7 (Haseeb — Claims & Status):** `AUDIT_ACTIONS.CLAIM_SUBMITTED` / `CLAIM_STATUS_CHANGED` on `AUDIT_ENTITIES.CLAIM`.
