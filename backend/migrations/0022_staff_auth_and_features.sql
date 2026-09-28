-- Migration 0022: Staff auth overhaul + feature tables
-- Adds: isFirstLogin, staffTrustedDevices, fixes staffOtpCodes (hash + attempts),
--        staff_attendance, payslips, staff_profile_change_requests, memoType on staff_memos

-- ── staff: first-login flag ───────────────────────────────────────────────────
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "isFirstLogin" BOOLEAN NOT NULL DEFAULT true;

-- ── staff_otp_codes: security fix (plaintext → hash) + attempts + new purpose ─
-- Rename the plaintext code column to codeHash
ALTER TABLE "staff_otp_codes" RENAME COLUMN "code" TO "codeHash";
-- Add wrong-attempt counter
ALTER TABLE "staff_otp_codes" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
-- Widen purpose check to include login_device
ALTER TABLE "staff_otp_codes" DROP CONSTRAINT IF EXISTS "staff_otp_codes_purpose_check";
ALTER TABLE "staff_otp_codes" ADD CONSTRAINT "staff_otp_codes_purpose_check"
  CHECK ("purpose" IN ('password_reset', 'login_device'));

-- ── staff_trusted_devices ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "staff_trusted_devices" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"     UUID NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "tokenHash"   TEXT NOT NULL,
  "userAgent"   TEXT,
  "lastUsedAt"  TIMESTAMPTZ NOT NULL,
  "expiresAt"   TIMESTAMPTZ NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_staff_trusted_devices_staff"
  ON "staff_trusted_devices"("staffId");

-- ── staff_attendance ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "staff_attendance" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"       UUID NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "date"          DATE NOT NULL,
  "clockIn"       TIME,
  "clockOut"      TIME,
  "hoursWorked"   NUMERIC(4,2),
  "status"        TEXT NOT NULL DEFAULT 'present'
                    CHECK ("status" IN ('present','absent','late','half_day','leave')),
  "periodLabel"   TEXT,
  "uploadBatchId" UUID,
  "uploadedById"  TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("staffId", "date")
);

CREATE INDEX IF NOT EXISTS "idx_staff_attendance_staff_date"
  ON "staff_attendance"("staffId", "date");

-- ── payslips ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payslips" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"      UUID NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "payPeriod"    DATE NOT NULL,
  "grossPay"     NUMERIC(10,2),
  "netPay"       NUMERIC(10,2),
  "deductions"   JSONB NOT NULL DEFAULT '{}',
  "fileUrl"      TEXT,
  "status"       TEXT NOT NULL DEFAULT 'draft'
                   CHECK ("status" IN ('draft','published')),
  "publishedAt"  TIMESTAMPTZ,
  "uploadedById" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("staffId", "payPeriod")
);

CREATE INDEX IF NOT EXISTS "idx_payslips_staff_period"
  ON "payslips"("staffId", "payPeriod");

-- ── staff_profile_change_requests ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "staff_profile_change_requests" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"        UUID NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "changeType"     TEXT NOT NULL
                     CHECK ("changeType" IN ('bank_details','bio','contact','emergency_contact','other')),
  "requestedData"  JSONB NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending'
                     CHECK ("status" IN ('pending','approved','rejected')),
  "reviewedById"   TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "reviewedAt"     TIMESTAMPTZ,
  "reviewComments" TEXT,
  "submittedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_staff_profile_change_requests_staff"
  ON "staff_profile_change_requests"("staffId");
CREATE INDEX IF NOT EXISTS "idx_staff_profile_change_requests_status"
  ON "staff_profile_change_requests"("status");

-- ── staff_memos: add memoType ─────────────────────────────────────────────────
ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "memoType" TEXT NOT NULL DEFAULT 'general'
  CHECK ("memoType" IN ('general','announcement','notice','meeting_memo'));
