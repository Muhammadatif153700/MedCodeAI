# MedCodeAI — KAN-6 API Inventory & Contract (`11 Mounted Operations`)

> **Scope Note:** `backend/docs/openapi.yaml` documents the **32 verified `KAN-4` operations**. This document inventories the **11 mounted `KAN-6` operations** (`10` under `/api/v1/payers` and `1` under `/api/v1/validation`), bringing the combined backend to **43 mounted `/api/v1` operations**.

---

## 1. Mounted KAN-6 Endpoints

| Method & Path | Required Roles | Validation & Audit | Notes |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/payers/icd10` | `ADMIN`, `CODER` | Auth + RBAC | Lists ICD-10 code catalog |
| `POST /api/v1/payers/icd10` | `ADMIN` | Zod (`code`, `description`) + atomic `CODE_LIBRARY_UPDATED` (`entityId: null`) | Returns `409` on duplicate `code` |
| `GET /api/v1/payers/cpt` | `ADMIN`, `CODER` | Auth + RBAC | Lists CPT code catalog |
| `POST /api/v1/payers/cpt` | `ADMIN` | Zod (`code`, `description`) + atomic `CODE_LIBRARY_UPDATED` (`entityId: null`) | Returns `409` on duplicate `code` |
| `GET /api/v1/payers/modifiers` | `ADMIN`, `CODER` | Auth + RBAC | Lists modifier catalog |
| `GET /api/v1/payers/rules/:payerId` | `ADMIN`, `BILLING_SPECIALIST` | Zod `:payerId` positive int | Lists rules for `payerId` |
| `POST /api/v1/payers/rules` | `ADMIN` | Zod (`payerId`, `planId?`, `ruleType`, `ruleJson`, `effectiveDate`) + atomic `PAYER_RULE_CREATED` | Persists payer rule |
| `GET /api/v1/payers/claim-edits` | `ADMIN`, `CODER`, `BILLING_SPECIALIST` | Auth + RBAC | Lists claim edit rules |
| `GET /api/v1/payers/rates` | `ADMIN`, `BILLING_SPECIALIST` | Auth + RBAC | Lists rate references |
| `POST /api/v1/payers/rates` | `ADMIN` | Zod (`payerId`, `code`, `placeOfService` len 2, `geoArea`, `rate >= 0`, `effectiveDate`) + atomic `RATE_REFERENCE_CREATED` | Enforces `rate_references_rate_non_negative` |
| `POST /api/v1/validation/process-encounter` | `ADMIN`, `CODER`, `BILLING_SPECIALIST` | Zod (`encounterId`, `rawText` min 5, `placeOfService?`) + atomic `CLAIM_VALIDATED` + conditional `markValidated()` | Calls `ML_API_URL` outside DB tx (`503`/`502` if unavailable/invalid); checks coding snapshot before commit (`409` on mid-flight coding change) |
