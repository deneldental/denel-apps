-- Add surcharge columns — the counterpart to the existing discount columns.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- Staff needed a way to price a line ABOVE the catalog price (VIP add-ons,
-- after-hours work, case complexity), not just below it. The catalog's old
-- "guided price range" (services.priceMin/priceMax) was meant to cover this
-- but was never actually wired up end-to-end (the admin UI could only ever
-- save the range's minimum, and nothing on the estimate form let a price be
-- entered within it) — it's being retired in favour of this explicit,
-- per-line surcharge, mirroring the discount columns invoice_lines already
-- has. Unlike discount, surcharge carries no reason/eligibility gate by
-- design: governance is an admin-only surcharges-vs-discounts report, not a
-- checkout-time prompt.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS throughout.

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS surcharge_type text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS surcharge_value integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS surcharge_amount integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS surcharge_authorized_by text REFERENCES "user"(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS surcharge_total integer NOT NULL DEFAULT 0;
