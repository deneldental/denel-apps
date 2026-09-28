-- Phases 2–4 schema foundations — all additive, all idempotent.
--
-- Touches: staff (new columns), staff_credentials (verification + lapse flag),
-- permission_bundles (parent_bundle_id), and adds nine net-new tables.

-- ── staff additions ──────────────────────────────────────────────────────────
ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "managerId" uuid,
  ADD COLUMN IF NOT EXISTS "dateOfBirth" timestamp,
  ADD COLUMN IF NOT EXISTS "probationEndDate" timestamp,
  ADD COLUMN IF NOT EXISTS "contractEndDate" timestamp;

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_managerId_staff_id_fk";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_managerId_staff_id_fk"
  FOREIGN KEY ("managerId") REFERENCES "staff"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "staff_managerId_idx" ON "staff" ("managerId");

-- ── permission_bundles parent FK ─────────────────────────────────────────────
ALTER TABLE "permission_bundles"
  ADD COLUMN IF NOT EXISTS "parentBundleId" text;

ALTER TABLE "permission_bundles" DROP CONSTRAINT IF EXISTS "permission_bundles_parentBundleId_fk";
ALTER TABLE "permission_bundles"
  ADD CONSTRAINT "permission_bundles_parentBundleId_fk"
  FOREIGN KEY ("parentBundleId") REFERENCES "permission_bundles"("id") ON DELETE SET NULL;

-- ── staff_credentials additions (Phase 3D) ───────────────────────────────────
ALTER TABLE "staff_credentials"
  ADD COLUMN IF NOT EXISTS "verifiedById" text,
  ADD COLUMN IF NOT EXISTS "verifiedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "verificationMethod" text,
  ADD COLUMN IF NOT EXISTS "suspendedDueToLapse" boolean DEFAULT false NOT NULL;

ALTER TABLE "staff_credentials" DROP CONSTRAINT IF EXISTS "staff_credentials_verifiedById_user_id_fk";
ALTER TABLE "staff_credentials"
  ADD CONSTRAINT "staff_credentials_verifiedById_user_id_fk"
  FOREIGN KEY ("verifiedById") REFERENCES "user"("id") ON DELETE SET NULL;

-- ── staff_request_approvals ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "staff_request_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requestId" uuid NOT NULL REFERENCES "staff_requests"("id") ON DELETE CASCADE,
  "stepOrder" integer NOT NULL,
  "approverUserId" text REFERENCES "user"("id") ON DELETE SET NULL,
  "approverRole" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "comments" text,
  "required" boolean DEFAULT true NOT NULL,
  "decidedAt" timestamp,
  "decidedById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "staff_request_approvals_request_idx"
  ON "staff_request_approvals" ("requestId", "stepOrder");

-- ── staff_lifecycle_tasks ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "staff_lifecycle_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "taskKey" text NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "assigneeUserId" text REFERENCES "user"("id") ON DELETE SET NULL,
  "dueAt" timestamp,
  "completedAt" timestamp,
  "completedById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "notes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "staff_lifecycle_tasks_staff_idx"
  ON "staff_lifecycle_tasks" ("staffId", "status");
CREATE INDEX IF NOT EXISTS "staff_lifecycle_tasks_kind_idx"
  ON "staff_lifecycle_tasks" ("kind");

-- ── job_grades + staff_compensation_history ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "job_grades" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "minSalary" numeric(12, 2),
  "maxSalary" numeric(12, 2),
  "currency" text DEFAULT 'GHS' NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "staff_compensation_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "effectiveFrom" timestamp NOT NULL,
  "effectiveTo" timestamp,
  "baseAmount" numeric(12, 2) NOT NULL,
  "currency" text DEFAULT 'GHS' NOT NULL,
  "jobGradeId" uuid REFERENCES "job_grades"("id") ON DELETE SET NULL,
  "reason" text,
  "notes" text,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "staff_comp_history_staff_idx"
  ON "staff_compensation_history" ("staffId", "effectiveFrom");

-- ── review_cycles + participants + goals + 1:1 notes ─────────────────────────
CREATE TABLE IF NOT EXISTS "review_cycles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "cycleType" text DEFAULT 'quarterly' NOT NULL,
  "startDate" timestamp NOT NULL,
  "endDate" timestamp NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "review_cycle_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cycleId" uuid NOT NULL REFERENCES "review_cycles"("id") ON DELETE CASCADE,
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'pending' NOT NULL,
  "overallScore" real,
  "selfAssessment" text,
  "managerAssessment" text,
  "selfSubmittedAt" timestamp,
  "managerSubmittedAt" timestamp,
  "finalizedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "review_cycle_participant_unique_idx"
  ON "review_cycle_participants" ("cycleId", "staffId");

CREATE TABLE IF NOT EXISTS "staff_goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "cycleId" uuid REFERENCES "review_cycles"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "description" text,
  "category" text,
  "targetDate" timestamp,
  "status" text DEFAULT 'open' NOT NULL,
  "progressPercent" integer DEFAULT 0 NOT NULL,
  "outcomeNotes" text,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "staff_goals_staff_idx" ON "staff_goals" ("staffId", "status");

CREATE TABLE IF NOT EXISTS "staff_one_on_one_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "managerUserId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "meetingDate" timestamp NOT NULL,
  "agenda" text,
  "notes" text,
  "actionItems" jsonb DEFAULT '[]'::jsonb,
  "privateNote" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "staff_one_on_one_staff_idx"
  ON "staff_one_on_one_notes" ("staffId", "meetingDate");

-- ── salary_components + payroll_runs + payroll_tax_brackets ──────────────────
CREATE TABLE IF NOT EXISTS "salary_components" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "currency" text DEFAULT 'GHS' NOT NULL,
  "taxable" boolean DEFAULT true NOT NULL,
  "effectiveFrom" timestamp NOT NULL,
  "effectiveTo" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "salary_components_staff_idx"
  ON "salary_components" ("staffId", "effectiveFrom");

CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "payPeriodStart" timestamp NOT NULL,
  "payPeriodEnd" timestamp NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "totalGross" numeric(14, 2),
  "totalNet" numeric(14, 2),
  "totalPaye" numeric(14, 2),
  "totalSsnit" numeric(14, 2),
  "staffCount" integer DEFAULT 0 NOT NULL,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "lockedAt" timestamp,
  "publishedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payroll_tax_brackets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bracketYear" integer NOT NULL,
  "taxType" text NOT NULL,
  "lowerBoundMonthly" numeric(12, 2) NOT NULL,
  "upperBoundMonthly" numeric(12, 2),
  "ratePercent" numeric(6, 4) NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "payroll_tax_brackets_year_type_idx"
  ON "payroll_tax_brackets" ("bracketYear", "taxType", "lowerBoundMonthly");

-- ── shifts + shift_assignments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "shifts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "startTime" text NOT NULL,
  "endTime" text NOT NULL,
  "weekdays" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
  "color" text,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "shift_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shiftId" uuid NOT NULL REFERENCES "shifts"("id") ON DELETE CASCADE,
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "date" text NOT NULL,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "swappedWithStaffId" uuid,
  "notes" text,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "shift_assignments_date_idx"
  ON "shift_assignments" ("date", "shiftId");
CREATE INDEX IF NOT EXISTS "shift_assignments_staff_idx"
  ON "shift_assignments" ("staffId", "date");

-- ── training_attempts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "training_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "trainingId" uuid NOT NULL REFERENCES "training_materials"("id") ON DELETE CASCADE,
  "attemptNumber" integer NOT NULL,
  "score" real,
  "awaitingReview" boolean DEFAULT false NOT NULL,
  "passed" boolean DEFAULT false NOT NULL,
  "answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "startedAt" timestamp,
  "submittedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "training_attempts_staff_training_idx"
  ON "training_attempts" ("staffId", "trainingId", "attemptNumber");

-- ── staff_credential_documents (version history) ─────────────────────────────
CREATE TABLE IF NOT EXISTS "staff_credential_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "credentialId" uuid NOT NULL REFERENCES "staff_credentials"("id") ON DELETE CASCADE,
  "versionNumber" integer NOT NULL,
  "documentUrl" text NOT NULL,
  "issueDate" timestamp,
  "expiryDate" timestamp,
  "uploadedById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "uploadedAt" timestamp DEFAULT now() NOT NULL,
  "notes" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "staff_credential_docs_unique_version_idx"
  ON "staff_credential_documents" ("credentialId", "versionNumber");

