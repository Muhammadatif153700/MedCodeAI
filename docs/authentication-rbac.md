# MedCodeAI — Authentication, JWT & RBAC Guide (KAN-12, KAN-13, KAN-14)

> **Status (Phase 6):** Public registration (`POST /api/v1/auth/register`), JWT login (`POST /api/v1/auth/login`), identity check (`GET /api/v1/auth/me`), `authenticate` & `authorize` middleware, and Admin-only `GET /api/v1/audit-logs` are implemented. **Admin user management (`KAN-15`), Profile update (`KAN-16`), and Patient/Provider/Encounter CRUD (`KAN-17`–`KAN-19`) are NOT implemented yet.**

---

## 1. Authentication API Endpoints (`/api/v1/auth`)

### `POST /api/v1/auth/register` (`KAN-12` / `UC-01`)
* **Request:** `{ "name": "Jane Doe", "email": "jane@example.com", "password": "StrongPassword123!" }`
* **Behavior:** Normalizes email, enforces bcrypt 72-byte password limit, rejects extra/privilege fields (`roleId`, `role`, `accountStatus`, `isActive`), creates user with `accountStatus = PENDING`, `roleId = null`, hashes password with `bcryptjs`, and logs `USER_REGISTERED` atomically. **Does not issue a JWT.**
* **Response (`201 Created`):** `{ "success": true, "data": { "user": { "id": 9, "name": "Jane Doe", "email": "jane@example.com", "roleId": null, "role": null, "accountStatus": "PENDING", "isActive": true, "createdAt": "..." } } }`

### `POST /api/v1/auth/login` (`KAN-13` / `UC-02`)
* **Request:** `{ "email": "coder1.demo@medcodeai.local", "password": "..." }`
* **Behavior:** Constant-time-safe password check, rejects disabled/pending/rejected/unassigned-role accounts, signs `HS256` JWT (`sub`, `exp`, `iss`, `aud`), and logs `USER_LOGIN_SUCCESS` (or `USER_LOGIN_FAILED` for known users).
* **Response (`200 OK`):** `{ "success": true, "data": { "token": "<jwt>", "user": { ... } } }`

### `GET /api/v1/auth/me`
* **Headers:** `Authorization: Bearer <jwt>`
* **Response (`200 OK`):** `{ "success": true, "data": { "user": req.user } }`

---

## 2. JWT & Middleware Contracts

* **JWT Config:** `JWT_SECRET` (min 32 chars, no insecure default), `JWT_EXPIRES_IN=1h`, `JWT_ISSUER=medcodeai-api`, `JWT_AUDIENCE=medcodeai-client`, fixed `HS256` algorithm.
* **Import Paths (from `backend/src/modules/<module>/`):**
  ```js
  const { authenticate } = require('../../middleware/auth.middleware');
  const { authorize } = require('../../middleware/rbac.middleware');
  const { ROLES } = require('../../constants/roles');
  ```
* **`req.user` Structure (reloaded from PostgreSQL on every request):**
  ```js
  {
    id: 4,
    name: 'Synthetic Coder One',
    email: 'coder1.demo@medcodeai.local',
    roleId: 3,
    role: 'CODER',
    accountStatus: 'APPROVED',
  }
  ```
* **Revocation / Role Changes:** Because `authenticate` queries PostgreSQL on every request, disabling an account or changing its role takes effect immediately on the next request without waiting for JWT expiration.

---

## 3. Role-Permission Matrix (Deliverable 2 Table 2 & Use Cases)

| Capability | `ADMIN` | `BILLING_SPECIALIST` | `CODER` | `REVIEWER` |
| :--- | :---: | :---: | :---: | :---: |
| Manage users, roles, payers, rules, codes, rates | Yes | — | — | — |
| Manage patients, providers, encounters | Yes | Yes | Yes | — |
| Upload & manage medical records | Yes | Yes | Yes | *(Ambiguity: needs read-only evidence view for `UC-15`)* |
| Run AI parsing & coding suggestions | — | — | Yes | — |
| Review AI coding output (`UC-15`) | — | — | — | Yes |
| Run claim validation & denial risk | *(UC-20/21)* | Yes | Yes *(validation)* | View only |
| Reimbursement estimate (`UC-22`) | — | Yes | — | — |
| Generate/export reports (`UC-23`/`UC-24`) | Yes | Yes | Yes | View only |
| Auto-fill, submit claim, track status | — | Yes | — | — |
| Domain chatbot (`UC-28`) | Yes | Yes | Yes | Yes |
| View audit logs (`GET /api/v1/audit-logs`) | Yes | — | — | — |

*`PENDING` accounts cannot access any protected endpoint. `authorize(...roles)` denies by default and has no implicit `ADMIN` bypass.*

---

## 4. Error Codes
* `401`: `AUTHENTICATION_REQUIRED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`
* `403`: `FORBIDDEN`, `ACCOUNT_DISABLED`, `ACCOUNT_PENDING_APPROVAL`, `ACCOUNT_REJECTED`, `ACCOUNT_NOT_APPROVED`, `ROLE_NOT_ASSIGNED`
* `409`: `EMAIL_ALREADY_REGISTERED` | `429`: `AUTH_RATE_LIMIT_EXCEEDED` | `503`: `AUTH_VERIFICATION_UNAVAILABLE`

---

## 5. Teammate Integration Examples (Illustrative Routes)

```js
// Farhan (KAN-5: Records & AI Coding)
router.post('/records', authenticate, authorize(ROLES.ADMIN, ROLES.BILLING_SPECIALIST, ROLES.CODER), recordController.upload);
router.post('/records/:id/analyze', authenticate, authorize(ROLES.CODER), codingController.analyze);
router.put('/suggestions/:id/review', authenticate, authorize(ROLES.REVIEWER), codingController.review);

// Atif (KAN-6: Payers & Validation)
router.post('/payers', authenticate, authorize(ROLES.ADMIN), payerController.create);
router.post('/encounters/:id/validate', authenticate, authorize(ROLES.BILLING_SPECIALIST, ROLES.CODER, ROLES.ADMIN), validationController.validate);

// Haseeb (KAN-7: Claims & Reports)
router.post('/claims/:id/submit', authenticate, authorize(ROLES.BILLING_SPECIALIST), claimController.submit);
router.post('/encounters/:id/reports', authenticate, authorize(ROLES.ADMIN, ROLES.BILLING_SPECIALIST, ROLES.CODER), reportController.generate);
```
