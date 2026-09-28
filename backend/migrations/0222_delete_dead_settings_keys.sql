-- Clear the rows of settings keys that no longer exist.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- settings-domain-audit S5 (2026-09-23): these keys were written by Settings
-- sections that nothing ever read ("decorative" settings). The sections and
-- their registry entries are gone, so `GET/PUT /api/settings/kv/:key` now
-- answers 404 for them; this removes whatever rows a database accumulated.
--
--   finance:currency, finance:numbering_sequences, scheduling:policies,
--   security:session_policy, compliance:credential_alert_days,
--   hr:working_hours_policy            — sections removed in S5
--   finance:payment_terms, finance:aging_buckets
--                                      — listed in the old SESSION_READABLE_KEYS,
--                                        never written or read
--
-- `security:kiosk_config` survives with only `idleLockSeconds` (the field the
-- kiosk page reads); a stored value is trimmed to that field.
--
-- Idempotent.

DELETE FROM clinic_settings
WHERE key IN (
  'finance:currency',
  'finance:numbering_sequences',
  'scheduling:policies',
  'security:session_policy',
  'compliance:credential_alert_days',
  'hr:working_hours_policy',
  'finance:payment_terms',
  'finance:aging_buckets'
);
--> statement-breakpoint
UPDATE clinic_settings
SET value = jsonb_build_object('idleLockSeconds', value -> 'idleLockSeconds')
WHERE key = 'security:kiosk_config'
  AND jsonb_typeof(value) = 'object'
  AND value ? 'idleLockSeconds'
  AND (value - 'idleLockSeconds') <> '{}'::jsonb;
