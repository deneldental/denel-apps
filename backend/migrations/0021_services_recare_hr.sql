-- Migration 0021: Services catalog, Recare plans, HR staff type, Consent share tokens

-- ── Staff: add staffType column ───────────────────────────────────────────────
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "staffType" TEXT NOT NULL DEFAULT 'internal'
  CHECK ("staffType" IN ('internal', 'external'));

-- ── Services: price catalog ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "services" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "category"            TEXT NOT NULL CHECK ("category" IN ('clinic', 'xray', 'lab', 'insurance')),
  "name"                TEXT NOT NULL,
  "treatmentTypeId"     UUID REFERENCES "treatment_types"("id") ON DELETE SET NULL,
  "xrayTypeId"          UUID,
  "labServiceId"        UUID REFERENCES "lab_services"("id") ON DELETE SET NULL,
  "insuranceCompanyId"  UUID REFERENCES "insurance_companies"("id") ON DELETE CASCADE,
  "amount"              REAL NOT NULL,
  "currency"            TEXT NOT NULL DEFAULT 'GHS',
  "isActive"            BOOLEAN NOT NULL DEFAULT true,
  "discountEligible"    BOOLEAN NOT NULL DEFAULT true,
  "status"              TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('pending', 'active')),
  "createdById"         TEXT NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "approvedById"        TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "approvedAt"          TIMESTAMPTZ,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_services_category" ON "services"("category");
CREATE INDEX IF NOT EXISTS "idx_services_treatment_type" ON "services"("treatmentTypeId");
CREATE INDEX IF NOT EXISTS "idx_services_xray_type" ON "services"("xrayTypeId");
CREATE INDEX IF NOT EXISTS "idx_services_insurance" ON "services"("insuranceCompanyId", "isActive");

-- ── Service change requests (non-admin approval workflow) ─────────────────────
CREATE TABLE IF NOT EXISTS "service_change_requests" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "serviceId"        UUID NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "requestedById"    TEXT NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "requestType"      TEXT NOT NULL CHECK ("requestType" IN ('update', 'deactivate', 'activate')),
  "currentValue"     JSONB NOT NULL,
  "requestedValue"   JSONB NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
  "reviewedById"     TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "reviewedAt"       TIMESTAMPTZ,
  "rejectionReason"  TEXT,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Recare plans (replaces recalls) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "recare_plans" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "scopeType"        TEXT NOT NULL CHECK ("scopeType" IN ('treatment', 'patient')),
  "treatmentTypeId"  UUID,
  "patientId"        UUID NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "durationValue"    INTEGER NOT NULL,
  "durationUnit"     TEXT NOT NULL CHECK ("durationUnit" IN ('days', 'weeks', 'months')),
  "recurrence"       TEXT NOT NULL CHECK ("recurrence" IN ('one_time', 'recurring')),
  "nextAlertDate"    TIMESTAMPTZ NOT NULL,
  "lastAlertDate"    TIMESTAMPTZ,
  "templateId"       UUID,
  "customMessage"    TEXT,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "status"           TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'alerted', 'completed', 'dismissed')),
  "createdById"      TEXT NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "completedAt"      TIMESTAMPTZ,
  "completedById"    TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "notes"            TEXT,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_recare_patient" ON "recare_plans"("patientId");
CREATE INDEX IF NOT EXISTS "idx_recare_treatment" ON "recare_plans"("treatmentTypeId");
CREATE INDEX IF NOT EXISTS "idx_recare_next_alert" ON "recare_plans"("nextAlertDate") WHERE "isActive" = true;

-- ── Consent share tokens (remote signing links) ───────────────────────────────
CREATE TABLE IF NOT EXISTS "consent_share_tokens" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "templateId"   UUID NOT NULL REFERENCES "consent_form_templates"("id") ON DELETE CASCADE,
  "patientId"    UUID REFERENCES "patients"("id") ON DELETE SET NULL,
  "token"        TEXT NOT NULL UNIQUE,
  "expiresAt"    TIMESTAMPTZ NOT NULL,
  "usedAt"       TIMESTAMPTZ,
  "sentTo"       TEXT NOT NULL,
  "sentVia"      TEXT NOT NULL CHECK ("sentVia" IN ('sms', 'whatsapp')),
  "createdById"  TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_consent_share_tokens_token" ON "consent_share_tokens"("token");

-- ── Drop recalls table (replaced by recare_plans) ─────────────────────────────
DROP TABLE IF EXISTS "recalls";
