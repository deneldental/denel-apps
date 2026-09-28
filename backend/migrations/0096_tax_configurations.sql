-- admin-v1 F1 — tax_configurations registry (GRA rates) + seed.
-- The single source of truth the tax/calc engines read at runtime. Excludes
-- PAYE/SSNIT — those live in payroll_tax_brackets (admin-v1 §14.3).
-- Idempotent: CREATE IF NOT EXISTS + seed guarded by NOT EXISTS per taxType.

CREATE TABLE IF NOT EXISTS "tax_configurations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "taxType" text NOT NULL,
  "rate" numeric(5, 4) NOT NULL,
  "applicableTo" text DEFAULT 'income' NOT NULL,
  "effectiveFrom" timestamp DEFAULT now() NOT NULL,
  "effectiveTo" timestamp,
  "isActive" boolean DEFAULT true NOT NULL,
  "notes" text,
  "createdById" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Seed current GRA rates. Idempotent: only inserts a taxType that has no
-- active row yet, so re-running the migration never duplicates rates.
INSERT INTO "tax_configurations" ("taxType", "rate", "applicableTo", "notes")
SELECT v.t, v.r, v.a, v.n
FROM (VALUES
  ('VAT', 0.1500, 'income', 'Standard VAT'),
  ('NHIL', 0.0250, 'income', 'National Health Insurance Levy'),
  ('GETFund', 0.0250, 'income', 'Ghana Education Trust Fund levy'),
  ('WHT_Services', 0.0500, 'contractors', 'Withholding tax on services / locum'),
  ('WHT_Insurance', 0.0500, 'income', 'Withholding tax on insurance payouts'),
  ('CIT_Rate', 0.2500, 'income', 'Corporate income tax')
) AS v(t, r, a, n)
WHERE NOT EXISTS (
  SELECT 1 FROM "tax_configurations" x WHERE x."taxType" = v.t AND x."isActive" = true
);
