-- 6.1-6.4 — add CDT code, procedure duration, effective-date pricing, and COGS to services
ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "cdtCode"          text,
  ADD COLUMN IF NOT EXISTS "durationMinutes"  integer,
  ADD COLUMN IF NOT EXISTS "effectiveFrom"    date,
  ADD COLUMN IF NOT EXISTS "costPrice"        numeric(15,2);
