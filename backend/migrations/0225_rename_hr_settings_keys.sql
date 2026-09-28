-- Rename the five HR settings keys from the `hr.` to the `hr:` namespace.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- settings-domain-audit D1 (S6, 2026-09-24): every generic clinic-settings key
-- uses `<domain>:<name>` except these five, which used a dot. The registry
-- keeps an alias so a client still sending `hr.x` reads and writes `hr:x`.
-- A legacy row whose canonical twin already exists is dropped (the canonical
-- row is the one clients have been writing since the rename).
--
-- Idempotent.

UPDATE clinic_settings
SET key = 'hr:' || substr(key, 4)
WHERE key IN (
  'hr.roster_enabled',
  'hr.org_chart_enabled',
  'hr.review_cycles_enabled',
  'hr.annual_leave_default_days',
  'hr.annual_leave_block_days'
)
  AND NOT EXISTS (
    SELECT 1 FROM clinic_settings c2 WHERE c2.key = 'hr:' || substr(clinic_settings.key, 4)
  );
--> statement-breakpoint
DELETE FROM clinic_settings
WHERE key IN (
  'hr.roster_enabled',
  'hr.org_chart_enabled',
  'hr.review_cycles_enabled',
  'hr.annual_leave_default_days',
  'hr.annual_leave_block_days'
);
