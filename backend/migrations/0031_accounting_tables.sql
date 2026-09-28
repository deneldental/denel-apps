-- 0031_accounting_tables.sql
-- Phase 1 — General Ledger foundation.
-- Creates: accounts (Chart of Accounts), accounting_periods, journal_entries,
-- journal_lines, number_sequences. All money columns are numeric(15, 2).

BEGIN;

-- ── Chart of Accounts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "accounts" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"                text NOT NULL,
  "name"                text NOT NULL,
  "type"                text NOT NULL,
  "subtype"             text,
  "parent_id"           uuid,
  "is_control"          boolean NOT NULL DEFAULT false,
  "control_party_type"  text,
  "normal_balance"      text NOT NULL,
  "is_active"           boolean NOT NULL DEFAULT true,
  "description"         text,
  "created_at"          timestamp NOT NULL DEFAULT NOW(),
  "updated_at"          timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "accounts_type_check" CHECK ("type" IN ('asset','liability','equity','revenue','expense')),
  CONSTRAINT "accounts_normal_balance_check" CHECK ("normal_balance" IN ('debit','credit')),
  CONSTRAINT "accounts_control_party_check" CHECK (
    "control_party_type" IS NULL
    OR "control_party_type" IN ('patient','supplier','specialist','insurance')
  ),
  CONSTRAINT "accounts_control_requires_party" CHECK (
    "is_control" = false OR "control_party_type" IS NOT NULL
  ),
  CONSTRAINT "accounts_parent_fk"
    FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "accounts_code_uniq" ON "accounts" ("code");
CREATE INDEX IF NOT EXISTS "accounts_type_idx" ON "accounts" ("type");
CREATE INDEX IF NOT EXISTS "accounts_parent_idx" ON "accounts" ("parent_id");

-- ── Accounting Periods ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "accounting_periods" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"        text NOT NULL,
  "start_date"  date NOT NULL,
  "end_date"    date NOT NULL,
  "status"      text NOT NULL DEFAULT 'open',
  "closed_at"   timestamp,
  "closed_by"   text,
  "created_at"  timestamp NOT NULL DEFAULT NOW(),
  "updated_at"  timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "accounting_periods_status_check" CHECK ("status" IN ('open','closed')),
  CONSTRAINT "accounting_periods_range_check" CHECK ("end_date" >= "start_date"),
  CONSTRAINT "accounting_periods_closed_by_fk"
    FOREIGN KEY ("closed_by") REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "accounting_periods_range_uniq"
  ON "accounting_periods" ("start_date", "end_date");
CREATE INDEX IF NOT EXISTS "accounting_periods_status_idx" ON "accounting_periods" ("status");

-- ── Journal Entries ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "journal_entries" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entry_number"        text NOT NULL,
  "entry_date"          date NOT NULL,
  "posted_at"           timestamp NOT NULL DEFAULT NOW(),
  "period_id"           uuid NOT NULL,
  "description"         text,
  "source_doc_type"     text NOT NULL,
  "source_doc_id"       uuid,
  "is_reversal"         boolean NOT NULL DEFAULT false,
  "reverses_entry_id"   uuid,
  "created_by"          text NOT NULL,
  "created_at"          timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "journal_entries_source_check" CHECK ("source_doc_type" IN (
    'invoice','payment','credit_note','refund','bill','specialist_payout',
    'write_off','manual','reversal','depreciation','period_close'
  )),
  CONSTRAINT "journal_entries_period_fk"
    FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT,
  CONSTRAINT "journal_entries_reverses_fk"
    FOREIGN KEY ("reverses_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  CONSTRAINT "journal_entries_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_number_uniq" ON "journal_entries" ("entry_number");
-- Idempotency: only one posted entry per (source_doc_type, source_doc_id) pair.
-- Manual entries don't have a source_doc_id so they can't collide.
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_source_uniq"
  ON "journal_entries" ("source_doc_type", "source_doc_id")
  WHERE "source_doc_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "journal_entries_date_idx" ON "journal_entries" ("entry_date");
CREATE INDEX IF NOT EXISTS "journal_entries_period_idx" ON "journal_entries" ("period_id");

-- ── Journal Lines ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "journal_lines" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entry_id"      uuid NOT NULL,
  "line_number"   integer NOT NULL,
  "account_id"    uuid NOT NULL,
  "debit"         numeric(15, 2) NOT NULL DEFAULT 0,
  "credit"        numeric(15, 2) NOT NULL DEFAULT 0,
  "party_type"    text,
  "party_id"      uuid,
  "description"   text,
  CONSTRAINT "journal_lines_entry_fk"
    FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  CONSTRAINT "journal_lines_account_fk"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT,
  CONSTRAINT "journal_lines_party_type_check" CHECK (
    "party_type" IS NULL OR "party_type" IN ('patient','supplier','specialist','insurance')
  ),
  CONSTRAINT "journal_lines_nonneg_check" CHECK ("debit" >= 0 AND "credit" >= 0),
  CONSTRAINT "journal_lines_xor_check" CHECK (
    ("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)
  )
);

CREATE INDEX IF NOT EXISTS "journal_lines_entry_idx" ON "journal_lines" ("entry_id");
CREATE INDEX IF NOT EXISTS "journal_lines_account_idx" ON "journal_lines" ("account_id");
CREATE INDEX IF NOT EXISTS "journal_lines_party_idx" ON "journal_lines" ("party_type", "party_id");

-- ── Number Sequences ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "number_sequences" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sequence_key"  text NOT NULL UNIQUE,
  "prefix"        text NOT NULL,
  "year_segment"  boolean NOT NULL DEFAULT true,
  "current_year"  integer,
  "next_number"   integer NOT NULL DEFAULT 1,
  "padding"       integer NOT NULL DEFAULT 6,
  "updated_at"    timestamp NOT NULL DEFAULT NOW()
);

-- Seed default sequence keys so the sequence-service can lock rows without
-- having to bootstrap on first use.
INSERT INTO "number_sequences" ("sequence_key", "prefix", "year_segment", "padding", "next_number")
VALUES
  ('journal_entry', 'JE-',   true, 6, 1),
  ('invoice',       'INV-',  true, 5, 1),
  ('payment',       'PMT-',  true, 6, 1),
  ('bill',          'BIL-',  true, 6, 1),
  ('credit_note',   'CN-',   true, 6, 1),
  ('payout',        'PAY-',  true, 6, 1),
  ('plan',          'PLN-',  true, 6, 1)
ON CONFLICT ("sequence_key") DO NOTHING;

COMMIT;
