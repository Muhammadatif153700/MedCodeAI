# MedCodeAI — User & Profile Management API (`KAN-15`, `KAN-16`)

---

## 1. Administrator User & Role Management (`KAN-15` / `UC-05`)
All endpoints require `authenticate` + `authorize(ROLES.ADMIN)`:
* `GET /api/v1/users/pending` — Paginated list of `PENDING` registrations (registered before `/:id`).
* `GET /api/v1/users` — Query: `page`, `limit` (max 100), `search` (name/email), `role`, `roleId`, `accountStatus` (`PENDING`|`APPROVED`|`REJECTED`), `isActive` (`true`|`false`). Never returns `passwordHash`.
* `GET /api/v1/users/:id` — Returns single user or `404 USER_NOT_FOUND`.
* `GET /api/v1/roles` — Lists the 4 business roles (`ADMIN`, `BILLING_SPECIALIST`, `CODER`, `REVIEWER`).
* `PATCH /api/v1/users/:id/approve` — Body: `{ "role": "CODER" }` (or `roleId`). Transitions `PENDING → APPROVED` with assigned role atomically; logs `USER_ACCOUNT_APPROVED` + `USER_ROLE_ASSIGNED`.
* `PATCH /api/v1/users/:id/reject` — Transitions `PENDING → REJECTED` (`roleId: null`); logs `USER_ACCOUNT_REJECTED`.
* `PATCH /api/v1/users/:id/role` — Body: `{ "role": "..." }`. Reassigns role for `APPROVED` users; blocks self-demotion (`400 SELF_DEMOTION_FORBIDDEN`) and demoting the last active `ADMIN` (`409 LAST_ADMIN_PROTECTION`).
* `PATCH /api/v1/users/:id/status` — Body: `{ "isActive": true | false }`. Activates/disables account without hard deletion; blocks self-disable (`400 SELF_DISABLE_FORBIDDEN`) and disabling the last active `ADMIN` (`409 LAST_ADMIN_PROTECTION`).

### Account Lifecycle & Concurrency Decisions
* Re-approving a `REJECTED` account is intentionally disallowed (`400 INVALID_ACCOUNT_TRANSITION`) because the original requirements do not define rejection reversal.
* Approval, rejection, role reassignment, and status changes execute inside `Serializable` Prisma transactions (`P2034` returns `409 CONCURRENT_MODIFICATION`).

---

## 2. Self-Service Profile Management (`KAN-16` / `UC-04`)
All endpoints require `authenticate` and operate strictly on `req.user.id`:
* `GET /api/v1/profile` — Returns current user's safe profile (reuses `UserService.getUserById(req.user.id)` alongside `GET /api/v1/auth/me`).
* `PATCH /api/v1/profile` — Body: `{ name?, email? }` (rejects privilege fields via `.strict()`). Checks duplicate email (`409 EMAIL_ALREADY_IN_USE`), logs `USER_PROFILE_UPDATED`.
* `PATCH /api/v1/profile/password` — Body: `{ currentPassword, newPassword }`. Verifies `currentPassword` (`401 INVALID_CURRENT_PASSWORD`), enforces `8..72` UTF-8 bytes, hashes with `bcryptjs`, logs `USER_PASSWORD_CHANGED`.

### JWT Behavior After Password, Role, or Status Changes (`Phase 9B`)
* `users.token_version` (`tokenVersion`) is embedded in JWTs as `tv` and verified against PostgreSQL on every request.
* **Password changes, role changes, account disabling, and reactivation atomically increment `tokenVersion`**, immediately revoking all previously issued JWTs (`401 TOKEN_REVOKED`) without exposing `tokenVersion` in API responses.
