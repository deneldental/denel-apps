-- Petty-cash replenishment log.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- settings-domain-audit S5-B (2026-09-23): `finance:petty_cash` promised a
-- box float and a low-float alert, but nothing recorded what went into the
-- box. Each row is cash put into the petty-cash box; the balance shown on the
-- Petty Cash page is the latest row's amount minus petty disbursements since
-- its date (the policy's default float stands in until the first row).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS petty_cash_replenishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date timestamp NOT NULL DEFAULT now(),
  amount integer NOT NULL,
  note text,
  "createdById" text REFERENCES "user"(id) ON DELETE SET NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT petty_cash_replenishments_amount_check CHECK (amount > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS petty_cash_replenishments_date_idx
  ON petty_cash_replenishments (date DESC, "createdAt" DESC);
