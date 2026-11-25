# MedCodeAI — Database Schema Documentation (KAN-10)

> **Status (Phase 3):** Schema defined in `backend/prisma/schema.prisma` and validated locally with Prisma `6.19.3`. **No database tables or migrations have been executed yet** (scheduled for Phase 4 / `KAN-11`).

---

## 1. Verified Table Count & 25-vs-26 Discrepancy Resolution

The Deliverable 2 PDF text (pp. 5, 23) states *"25 tables"*, but **Figure 5 (Section 3.3 ERD, p. 23) explicitly defines 26 distinct tables** across 7 color-coded modules:

1. **Users & Access (3):** `roles`, `users`, `audit_logs`
2. **Patients & Encounters (4):** `patients`, `providers`, `encounters`, `medical_records`
3. **AI & Coding (3):** `ai_analyses`, `coding_suggestions`, `suggestion_modifiers`
4. **Code Libraries (4):** `icd10_codes`, `cpt_codes`, `hcpcs_codes`, `modifiers`
5. **Payers & Rules (5):** `payers`, `insurance_plans`, `payer_rules`, `rate_references`, `claim_edit_rules`
6. **Validation, Reports & Claims (5):** `validation_results`, `denial_risks`, `reports`, `claims`, `claim_status_history`
7. **Chatbot (2):** `chat_sessions`, `chat_messages`

All **26 tables** are preserved in `backend/prisma/schema.prisma`.

---

## 2. Complete Entity Inventory

| # | Table (`@@map`) | Prisma Model | Module Owner | PK | Foreign Keys | Relevant FRs |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `roles` | `Role` | KAN-4 (Ali) | `id` (Int) | — | FR-05 |
| 2 | `users` | `User` | KAN-4 (Ali) | `id` (Int) | `role_id` → `roles.id` (optional) | FR-01–FR-05 |
| 3 | `audit_logs` | `AuditLog` | KAN-4 (Ali) | `id` (Int) | `user_id` → `users.id` | FR-29 |
| 4 | `patients` | `Patient` | KAN-4 (Ali) | `id` (Int) | — | FR-06 |
| 5 | `providers` | `Provider` | KAN-4 (Ali) | `id` (Int) | — | FR-06 |
| 6 | `encounters` | `Encounter` | KAN-4 (Ali) | `id` (Int) | `patient_id`, `provider_id`, `payer_id`, `plan_id` | FR-06, FR-30 |
| 7 | `medical_records` | `MedicalRecord` | KAN-5 (Farhan) | `id` (Int) | `encounter_id`, `uploaded_by` → `users.id` | FR-07–FR-10 |
| 8 | `ai_analyses` | `AiAnalysis` | KAN-5 (Farhan) | `id` (Int) | `record_id`, `run_by` → `users.id` | FR-11 |
| 9 | `coding_suggestions` | `CodingSuggestion` | KAN-5 (Farhan) | `id` (Int) | `analysis_id`, `icd10_code`, `cpt_code`, `hcpcs_code`, `reviewed_by` | FR-12–FR-15 |
| 10 | `suggestion_modifiers` | `SuggestionModifier` | KAN-5 (Farhan) | `id` (Int) | `suggestion_id`, `modifier_code` | FR-14, FR-15 |
| 11 | `icd10_codes` | `Icd10Code` | KAN-6 (Atif) | `code` (String) | — | FR-18 |
| 12 | `cpt_codes` | `CptCode` | KAN-6 (Atif) | `code` (String) | — | FR-18 |
| 13 | `hcpcs_codes` | `HcpcsCode` | KAN-6 (Atif) | `code` (String) | — | FR-18 |
| 14 | `modifiers` | `Modifier` | KAN-6 (Atif) | `code` (String) | — | FR-18 |
| 15 | `payers` | `Payer` | KAN-6 (Atif) | `id` (Int) | — | FR-16 |
| 16 | `insurance_plans` | `InsurancePlan` | KAN-6 (Atif) | `id` (Int) | `payer_id` → `payers.id` | FR-16 |
| 17 | `payer_rules` | `PayerRule` | KAN-6 (Atif) | `id` (Int) | `payer_id`, `plan_id` (optional) | FR-17 |
| 18 | `rate_references` | `RateReference` | KAN-6 (Atif) | `id` (Int) | `payer_id` → `payers.id` | FR-19, FR-22 |
| 19 | `claim_edit_rules` | `ClaimEditRule` | KAN-6 (Atif) | `id` (Int) | *(Standalone, no FKs)* | FR-17, FR-20 |
| 20 | `validation_results` | `ValidationResult` | KAN-6 (Atif) | `id` (Int) | `encounter_id` → `encounters.id` | FR-20 |
| 21 | `denial_risks` | `DenialRisk` | KAN-6 (Atif) | `id` (Int) | `encounter_id` → `encounters.id` | FR-21 |
| 22 | `reports` | `Report` | KAN-7 (Haseeb) | `id` (Int) | `encounter_id`, `generated_by` → `users.id` | FR-23, FR-24 |
| 23 | `claims` | `Claim` | KAN-7 (Haseeb) | `id` (Int) | `encounter_id`, `submitted_by` (optional) | FR-25–FR-27 |
| 24 | `claim_status_history` | `ClaimStatusHistory` | KAN-7 (Haseeb) | `id` (Int) | `claim_id` → `claims.id` | FR-27 |
| 25 | `chat_sessions` | `ChatSession` | *Unassigned (Open)* | `id` (Int) | `user_id` → `users.id` | FR-28 |
| 26 | `chat_messages` | `ChatMessage` | *Unassigned (Open)* | `id` (Int) | `session_id` → `chat_sessions.id` | FR-28 |

---

## 3. Original ERD vs. Proposed Engineering Additions

| Item | Original ERD (Figure 5) | Proposed Addition (`schema.prisma`) | Justification & Impact |
| :--- | :--- | :--- | :--- |
| `users.is_active` | Not shown | `Boolean @default(true)` | Required by `UC-02` alt flow 2b (*"Account disabled: access is refused"*). |
| `users.account_status` | Not shown | `AccountApprovalStatus @default(PENDING)` | Separates registration approval (`PENDING`/`APPROVED`/`REJECTED`) from the 4 business roles (`ADMIN`, `BILLING_SPECIALIST`, `CODER`, `REVIEWER`). Prevents self-registered users from accessing protected endpoints before Admin approval (`UC-01` → `UC-05`). |
| `users.role_id` | Mandatory FK (`1` to `0..*`) | Nullable `Int?` until `UC-05` | Allows `PENDING` users to register without assigning a privileged business role. |
| `medical_records.created_at` | Not shown | `DateTime @default(now())` | Required for `UC-08` date filtering and sorting. |
| `coding_suggestions.review_comment` | Not shown | `String?` | Required by `FR-15`, `UC-15`, and `SEQ-3` to store reviewer comments on edits/rejections. |
| `coding_suggestions.reviewed_by` | Mandatory-looking FK line | Nullable `Int?` | A suggestion starts as `SUGGESTED` before any Reviewer acts (`UC-12`–`UC-15`). |
| `claims.submitted_by` | Mandatory-looking FK line | Nullable `Int?` | A claim exists in `DRAFT`/`VALIDATED`/`READY` states before submission (`UC-25`, `UC-26`). |

---

## 4. Referential Actions & Data Integrity Constraints

### Referential Actions (`onDelete`)
* **`Restrict` (Default for core/audit/reference entities):** `User`, `Role`, `Patient`, `Provider`, `Payer`, `InsurancePlan`, `Encounter`, `MedicalRecord` (on `Encounter`), `Icd10Code`, `CptCode`, `HcpcsCode`, `Modifier`, `Report`, `Claim` (on `Encounter`). Prevents accidental cascading deletion of clinical, financial, or audit data.
* **`Cascade` (Composition/owned child artifacts):**
  * `MedicalRecord` → `AiAnalysis` (`UC-10`: deleting a record deletes its dependent analyses).
  * `AiAnalysis` → `CodingSuggestion` → `SuggestionModifier`.
  * `Claim` → `ClaimStatusHistory` (composition in Class Diagram, Fig. 7).
  * `ChatSession` → `ChatMessage` (composition in Class Diagram, Fig. 7).

### Constraints Requiring PostgreSQL `CHECK` (Phase 4 Migration) or Service Validation
Prisma cannot natively express cross-column `CHECK` constraints in `schema.prisma`:
1. **`coding_suggestions` code consistency:** Exactly one of `icd10_code`, `cpt_code`, `hcpcs_code` must be non-null and match `code_type` (`CHECK` constraint in Phase 4 SQL migration).
2. **`coding_suggestions.units > 0`:** Positive coding units (`CHECK (units > 0)`).
3. **`encounters` plan-payer match:** `plan.payer_id === encounter.payer_id` (enforced in `Encounter` service).
4. **`rate_references` non-overlapping effective dates (`UC-19` 3a):** Enforced in `RateService`.
5. **`audit_logs.entity_id`:** ERD specifies `int`, which works for integer-PK tables; string-PK code-library audits should store the code in `entity` or add a future `entity_ref` if needed.

---

## 5. Unresolved Discrepancies & Open Team Decisions
1. **`ClinicalFinding` (Domain/Class Diagrams) vs. `ai_analyses.extracted_json` (ERD):** `ClinicalFinding` is stored inside `extracted_json` (`Json`) per the ERD rather than a 27th table.
2. **Chatbot Ownership (`UC-28` / `chat_sessions` / `chat_messages`):** Not explicitly assigned across `KAN-4`–`KAN-7`; team must confirm owner.
3. **`PENDING` Approval Flow:** Confirm `account_status` + nullable `role_id` vs. a non-privileged role row in `roles`.
