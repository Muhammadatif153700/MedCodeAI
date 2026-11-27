# MedCodeAI — KAN-4 API Quick Reference & Teammate Integration Guide

## 1. Base URL & Authentication

- **Base URL:** `http://localhost:5000/api/v1`
- **Swagger UI (non-production):** `http://localhost:5000/api-docs`
- **Auth Header:** `Authorization: Bearer <jwt_token>`
- **Security Rule:** Frontend code (`React`/`Next.js`/etc.) **must never** connect directly to PostgreSQL or embed `DATABASE_URL`, `DIRECT_URL`, or `JWT_SECRET`. All client traffic must go through this Express REST API.

---

## 2. Role-Permission Matrix

| Resource / Endpoint Group | Public | `ADMIN` | `BILLING_SPECIALIST` | `CODER` | `REVIEWER` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `/health`, `/health/db` | Yes | Yes | Yes | Yes | Yes |
| `/auth/register`, `/auth/login` | Yes | Yes | Yes | Yes | Yes |
| `/auth/me`, `/profile`, `/profile/password` | No | Yes | Yes | Yes | Yes |
| `/users/*`, `/roles`, `/audit-logs` | No | **Yes** | No (`403`) | No (`403`) | No (`403`) |
| `/patients/*`, `/providers/*`, `/encounters/*` | No | **Yes** | **Yes** | **Yes** | No (`403`) |

---

## 3. Mounted KAN-4 Endpoints (32 Operations)

| Method & Path | Auth / Roles | Purpose |
| :--- | :--- | :--- |
| `GET /health` | Public | Application liveness |
| `GET /health/db` | Public | PostgreSQL readiness (`SELECT 1`) |
| `POST /auth/register` | Public | Register `PENDING` user (`roleId: null`) |
| `POST /auth/login` | Public | Authenticate approved user, returns JWT (`tv` claim) |
| `GET /auth/me` | Bearer (any approved) | Current authenticated user |
| `GET /profile` | Bearer (any approved) | Retrieve own profile |
| `PATCH /profile` | Bearer (any approved) | Update own `name` or `email` |
| `PATCH /profile/password` | Bearer (any approved) | Change password & revoke prior JWTs |
| `GET /users/pending` | `ADMIN` | Paginated pending accounts |
| `GET /users` | `ADMIN` | Paginated/filtered user list |
| `GET /users/:id` | `ADMIN` | Single user details |
| `PATCH /users/:id/approve` | `ADMIN` | Approve pending user & assign role |
| `PATCH /users/:id/reject` | `ADMIN` | Reject pending user |
| `PATCH /users/:id/role` | `ADMIN` | Reassign role & increment `tokenVersion` |
| `PATCH /users/:id/status` | `ADMIN` | Activate/disable account & increment `tokenVersion` |
| `GET /roles` | `ADMIN` | List 4 business roles |
| `GET /audit-logs` | `ADMIN` | Paginated/filtered append-only audit logs |
| `POST/GET/GET:id/PATCH:id/DELETE:id /patients` | `ADMIN`, `BILLING_SPECIALIST`, `CODER` | Patient CRUD & dependent-encounter delete guard |
| `POST/GET/GET:id/PATCH:id/DELETE:id /providers` | `ADMIN`, `BILLING_SPECIALIST`, `CODER` | Provider CRUD (unique 10-digit string NPI) |
| `POST/GET/GET:id/PATCH:id/DELETE:id /encounters` | `ADMIN`, `BILLING_SPECIALIST`, `CODER` | Encounter CRUD (`OPEN` metadata only; status locked) |

---

## 4. Response & Error Envelope

- **Success:** `{ "success": true, "data": ..., "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 } }`
- **Error:** `{ "success": false, "error": { "code": "ERROR_CODE", "message": "...", "details": [...] } }`

---

## 5. Backend Shared Service Imports & Lifecycle Contracts

```js
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');
const {
  startCoding,
  markValidated,
  markClaimSubmitted,
  closeEncounter,
} = require('../encounters');
```

- **Migration Requirement:** Teammate branches must run `npm run prisma:migrate:deploy` and `npm run prisma:generate` to receive `20261127000000_phase9b_security_hardening` (`users.token_version` and nullable `audit_logs.user_id`).

---

## 6. Frontend `fetch` Example

```js
const API_BASE = 'http://localhost:5000/api/v1';

async function loginAndFetchEncounters(email, password) {
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok) throw new Error(loginJson.error?.message || 'Login failed');

  const res = await fetch(`${API_BASE}/encounters?status=OPEN&page=1&limit=20`, {
    headers: { Authorization: `Bearer ${loginJson.data.token}` },
  });
  return res.json();
}
```
