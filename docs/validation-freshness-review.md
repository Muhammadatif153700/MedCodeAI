# MedCodeAI — Validation Freshness, Completeness & Transaction Review (`Milestone 3 Part 2B`)

## 1. Validation Freshness & Completeness Findings
- **External ML Non-Transactional Call:** `POST /api/v1/validation/process-encounter` executes `analyzeMedicalText(rawText)` **outside** any PostgreSQL transaction.
- **Mid-Flight Coding Change Guard (Implemented):** `validation.routes.js` captures `preSnapshot` (`encounter.status`, `acceptedSuggestions`, `pendingSuggestions`) before calling `ML_API_URL`, then re-queries inside the `Serializable` transaction and aborts with `409 CONCURRENT_MODIFICATION` if coding suggestions or encounter status changed while the ML request was in flight.
- **Lifecycle Gate:** `markValidated()` runs only when `encounter.status === 'CODING_IN_PROGRESS'`, `validation.overallStatus !== 'FAILED'`, `acceptedSuggestions >= 1`, `pendingSuggestions === 0`, and `failedValidations === 0`.
- **Remaining Schema Limitation (Historical `ValidationResult` Rows):** Because `ValidationResult` in `prisma/schema.prisma` has no `createdAt`, `runId`, or `codingSnapshotHash`, historical `FAILED` rows block `markValidated()` until superseded, and historical `PASSED` rows cannot be distinguished from a fresh `PASSED` run if `markValidated()` is called directly after coding edits.
- **Proposed Forward-Only Migration (Awaiting Approval):** Add `run_id UUID`, `created_at TIMESTAMPTZ DEFAULT now()`, and `coding_snapshot_hash TEXT` to `validation_results` (preserving all historical rows while letting `markValidated()` evaluate only the latest complete `run_id` matching the current coding snapshot).

---

## 2. `SERIALIZABLE_TX.timeout` Assessment (`15000 ms` -> `30000 ms`)
- **Query Audit:** `countEncounterDependents` already runs 5 indexed `count()` queries in parallel via `Promise.all` (`@@index([encounterId])` on all 5 tables).
- **Root Cause of Timeout:** Remote Neon Singapore TLS latency spiked to `22.8s` during Newman `deleteEncounter` cleanup, exceeding Prisma's `15000 ms` timeout.
- **Conclusion:** Increasing `SERIALIZABLE_TX.timeout` to `30000 ms` (`maxWait: 10000`) is justified for remote Neon TLS while preserving full `Serializable` isolation and `P2034` conflict detection.
