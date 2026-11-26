-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('OPEN', 'CODING_IN_PROGRESS', 'VALIDATED', 'CLAIM_SUBMITTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MedicalRecordStatus" AS ENUM ('UPLOADED', 'ANALYZING', 'ANALYZED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiAnalysisStatus" AS ENUM ('ANALYZING', 'ANALYZED', 'FAILED');

-- CreateEnum
CREATE TYPE "CodeType" AS ENUM ('ICD10', 'CPT', 'HCPCS');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('SUGGESTED', 'ACCEPTED', 'EDITED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('PASSED', 'WARNING', 'FAILED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('GENERATED', 'EXPORTED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'VALIDATED', 'READY', 'SUBMITTED', 'IN_PROCESS', 'PENDING_INFO', 'REJECTED', 'CORRECTED', 'RESUBMITTED', 'ACCEPTED', 'PAID', 'DENIED', 'APPEALED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatSender" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "account_status" "AccountApprovalStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" INTEGER,
    "ip_address" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "dob" DATE NOT NULL,
    "gender" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "npi" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounters" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "payer_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "encounter_date" DATE NOT NULL,
    "place_of_service" TEXT NOT NULL,
    "status" "EncounterStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_records" (
    "id" SERIAL NOT NULL,
    "encounter_id" INTEGER NOT NULL,
    "uploaded_by" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "status" "MedicalRecordStatus" NOT NULL DEFAULT 'UPLOADED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" SERIAL NOT NULL,
    "record_id" INTEGER NOT NULL,
    "run_by" INTEGER NOT NULL,
    "extracted_json" JSONB NOT NULL,
    "model_name" TEXT NOT NULL,
    "status" "AiAnalysisStatus" NOT NULL DEFAULT 'ANALYZING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coding_suggestions" (
    "id" SERIAL NOT NULL,
    "analysis_id" INTEGER NOT NULL,
    "code_type" "CodeType" NOT NULL,
    "icd10_code" TEXT,
    "cpt_code" TEXT,
    "hcpcs_code" TEXT,
    "description" TEXT NOT NULL,
    "supporting_text" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'SUGGESTED',
    "reviewed_by" INTEGER,
    "review_comment" TEXT,

    CONSTRAINT "coding_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestion_modifiers" (
    "id" SERIAL NOT NULL,
    "suggestion_id" INTEGER NOT NULL,
    "modifier_code" TEXT NOT NULL,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'SUGGESTED',

    CONSTRAINT "suggestion_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icd10_codes" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "icd10_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "cpt_codes" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "cpt_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "hcpcs_codes" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "hcpcs_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "modifiers" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "payers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,

    CONSTRAINT "payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_plans" (
    "id" SERIAL NOT NULL,
    "payer_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "auth_required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "insurance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_rules" (
    "id" SERIAL NOT NULL,
    "payer_id" INTEGER NOT NULL,
    "plan_id" INTEGER,
    "rule_type" TEXT NOT NULL,
    "rule_json" JSONB NOT NULL,
    "effective_date" DATE NOT NULL,

    CONSTRAINT "payer_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_references" (
    "id" SERIAL NOT NULL,
    "payer_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "place_of_service" TEXT NOT NULL,
    "geo_area" TEXT NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "effective_date" DATE NOT NULL,

    CONSTRAINT "rate_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_edit_rules" (
    "id" SERIAL NOT NULL,
    "rule_type" TEXT NOT NULL,
    "code_a" TEXT NOT NULL,
    "code_b" TEXT NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "claim_edit_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_results" (
    "id" SERIAL NOT NULL,
    "encounter_id" INTEGER NOT NULL,
    "rule_type" TEXT NOT NULL,
    "status" "ValidationStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "model_version" TEXT,

    CONSTRAINT "validation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "denial_risks" (
    "id" SERIAL NOT NULL,
    "encounter_id" INTEGER NOT NULL,
    "issue" TEXT NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "recommended_action" TEXT NOT NULL,

    CONSTRAINT "denial_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "encounter_id" INTEGER NOT NULL,
    "generated_by" INTEGER NOT NULL,
    "content_json" JSONB NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'GENERATED',

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" SERIAL NOT NULL,
    "encounter_id" INTEGER NOT NULL,
    "submitted_by" INTEGER,
    "form_data_json" JSONB NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "external_ref" TEXT,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_status_history" (
    "id" SERIAL NOT NULL,
    "claim_id" INTEGER NOT NULL,
    "status" "ClaimStatus" NOT NULL,
    "note" TEXT,
    "follow_up_date" DATE,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "sender" "ChatSender" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE INDEX "users_account_status_idx" ON "users"("account_status");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "patients_name_idx" ON "patients"("name");

-- CreateIndex
CREATE INDEX "patients_member_id_idx" ON "patients"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "providers_npi_key" ON "providers"("npi");

-- CreateIndex
CREATE INDEX "providers_name_idx" ON "providers"("name");

-- CreateIndex
CREATE INDEX "encounters_patient_id_idx" ON "encounters"("patient_id");

-- CreateIndex
CREATE INDEX "encounters_provider_id_idx" ON "encounters"("provider_id");

-- CreateIndex
CREATE INDEX "encounters_payer_id_idx" ON "encounters"("payer_id");

-- CreateIndex
CREATE INDEX "encounters_plan_id_idx" ON "encounters"("plan_id");

-- CreateIndex
CREATE INDEX "encounters_encounter_date_idx" ON "encounters"("encounter_date");

-- CreateIndex
CREATE INDEX "encounters_status_idx" ON "encounters"("status");

-- CreateIndex
CREATE INDEX "medical_records_encounter_id_idx" ON "medical_records"("encounter_id");

-- CreateIndex
CREATE INDEX "medical_records_uploaded_by_idx" ON "medical_records"("uploaded_by");

-- CreateIndex
CREATE INDEX "medical_records_status_idx" ON "medical_records"("status");

-- CreateIndex
CREATE INDEX "ai_analyses_record_id_idx" ON "ai_analyses"("record_id");

-- CreateIndex
CREATE INDEX "ai_analyses_run_by_idx" ON "ai_analyses"("run_by");

-- CreateIndex
CREATE INDEX "coding_suggestions_analysis_id_idx" ON "coding_suggestions"("analysis_id");

-- CreateIndex
CREATE INDEX "coding_suggestions_review_status_idx" ON "coding_suggestions"("review_status");

-- CreateIndex
CREATE INDEX "coding_suggestions_icd10_code_idx" ON "coding_suggestions"("icd10_code");

-- CreateIndex
CREATE INDEX "coding_suggestions_cpt_code_idx" ON "coding_suggestions"("cpt_code");

-- CreateIndex
CREATE INDEX "coding_suggestions_hcpcs_code_idx" ON "coding_suggestions"("hcpcs_code");

-- CreateIndex
CREATE INDEX "suggestion_modifiers_suggestion_id_idx" ON "suggestion_modifiers"("suggestion_id");

-- CreateIndex
CREATE INDEX "suggestion_modifiers_modifier_code_idx" ON "suggestion_modifiers"("modifier_code");

-- CreateIndex
CREATE UNIQUE INDEX "payers_name_key" ON "payers"("name");

-- CreateIndex
CREATE INDEX "insurance_plans_payer_id_idx" ON "insurance_plans"("payer_id");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_plans_payer_id_name_key" ON "insurance_plans"("payer_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_plans_id_payer_id_key" ON "insurance_plans"("id", "payer_id");

-- CreateIndex
CREATE INDEX "payer_rules_payer_id_idx" ON "payer_rules"("payer_id");

-- CreateIndex
CREATE INDEX "payer_rules_plan_id_idx" ON "payer_rules"("plan_id");

-- CreateIndex
CREATE INDEX "payer_rules_rule_type_idx" ON "payer_rules"("rule_type");

-- CreateIndex
CREATE INDEX "rate_references_payer_id_code_place_of_service_geo_area_idx" ON "rate_references"("payer_id", "code", "place_of_service", "geo_area");

-- CreateIndex
CREATE INDEX "rate_references_effective_date_idx" ON "rate_references"("effective_date");

-- CreateIndex
CREATE INDEX "claim_edit_rules_code_a_code_b_idx" ON "claim_edit_rules"("code_a", "code_b");

-- CreateIndex
CREATE INDEX "validation_results_encounter_id_idx" ON "validation_results"("encounter_id");

-- CreateIndex
CREATE INDEX "validation_results_status_idx" ON "validation_results"("status");

-- CreateIndex
CREATE INDEX "denial_risks_encounter_id_idx" ON "denial_risks"("encounter_id");

-- CreateIndex
CREATE INDEX "denial_risks_risk_level_idx" ON "denial_risks"("risk_level");

-- CreateIndex
CREATE INDEX "reports_encounter_id_idx" ON "reports"("encounter_id");

-- CreateIndex
CREATE INDEX "reports_generated_by_idx" ON "reports"("generated_by");

-- CreateIndex
CREATE INDEX "claims_encounter_id_idx" ON "claims"("encounter_id");

-- CreateIndex
CREATE INDEX "claims_submitted_by_idx" ON "claims"("submitted_by");

-- CreateIndex
CREATE INDEX "claims_status_idx" ON "claims"("status");

-- CreateIndex
CREATE INDEX "claim_status_history_claim_id_idx" ON "claim_status_history"("claim_id");

-- CreateIndex
CREATE INDEX "claim_status_history_changed_at_idx" ON "claim_status_history"("changed_at");

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_idx" ON "chat_sessions"("user_id");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_idx" ON "chat_messages"("session_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "insurance_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "medical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_run_by_fkey" FOREIGN KEY ("run_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_suggestions" ADD CONSTRAINT "coding_suggestions_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "ai_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_suggestions" ADD CONSTRAINT "coding_suggestions_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_suggestions" ADD CONSTRAINT "coding_suggestions_cpt_code_fkey" FOREIGN KEY ("cpt_code") REFERENCES "cpt_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_suggestions" ADD CONSTRAINT "coding_suggestions_hcpcs_code_fkey" FOREIGN KEY ("hcpcs_code") REFERENCES "hcpcs_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_suggestions" ADD CONSTRAINT "coding_suggestions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_modifiers" ADD CONSTRAINT "suggestion_modifiers_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "coding_suggestions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_modifiers" ADD CONSTRAINT "suggestion_modifiers_modifier_code_fkey" FOREIGN KEY ("modifier_code") REFERENCES "modifiers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_plans" ADD CONSTRAINT "insurance_plans_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_rules" ADD CONSTRAINT "payer_rules_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_rules" ADD CONSTRAINT "payer_rules_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "insurance_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_references" ADD CONSTRAINT "rate_references_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_risks" ADD CONSTRAINT "denial_risks_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Additional PostgreSQL Integrity Constraints (KAN-11 Task 4)
-- ============================================================================

-- 1. Coding suggestion units must be positive
ALTER TABLE "coding_suggestions"
  ADD CONSTRAINT "coding_suggestions_units_positive"
  CHECK ("units" > 0);

-- 2 & 3. Exactly one medical code reference must be present and match code_type
ALTER TABLE "coding_suggestions"
  ADD CONSTRAINT "coding_suggestions_code_reference_check"
  CHECK (
    ("code_type" = 'ICD10' AND "icd10_code" IS NOT NULL AND "cpt_code" IS NULL AND "hcpcs_code" IS NULL) OR
    ("code_type" = 'CPT'   AND "cpt_code"   IS NOT NULL AND "icd10_code" IS NULL AND "hcpcs_code" IS NULL) OR
    ("code_type" = 'HCPCS' AND "hcpcs_code" IS NOT NULL AND "icd10_code" IS NULL AND "cpt_code" IS NULL)
  );

-- 4. Monetary rates must not be negative
ALTER TABLE "rate_references"
  ADD CONSTRAINT "rate_references_rate_non_negative"
  CHECK ("rate" >= 0);

-- 5. Encounter's insurance plan must belong to its selected payer
ALTER TABLE "encounters"
  ADD CONSTRAINT "encounters_plan_payer_fkey"
  FOREIGN KEY ("plan_id", "payer_id") REFERENCES "insurance_plans"("id", "payer_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Approved accounts must have a valid business role
ALTER TABLE "users"
  ADD CONSTRAINT "users_approved_requires_role"
  CHECK ("account_status" <> 'APPROVED' OR "role_id" IS NOT NULL);


