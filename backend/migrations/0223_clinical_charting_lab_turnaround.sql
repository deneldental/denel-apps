-- `clinical:charting_preferences`: four prosthesis SLA fields → one default.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- settings-domain-audit S5-B (2026-09-23): crownSlaDays / bridgeSlaDays /
-- implantSlaDays / dentureSlaDays were saved and read by nothing — a lab
-- case's expected return already comes from the vendor offering, then the
-- base service, then a hardcoded 7 days. The owner replaced the four with one
-- `defaultLabTurnaroundDays`, which now is that final fallback. A stored row
-- loses the four keys and gains the new one (7 unless already present).
--
-- Idempotent.

UPDATE clinic_settings
SET value = (value - 'crownSlaDays' - 'bridgeSlaDays' - 'implantSlaDays' - 'dentureSlaDays')
            || jsonb_build_object(
                 'defaultLabTurnaroundDays',
                 COALESCE(value -> 'defaultLabTurnaroundDays', '7'::jsonb)
               )
WHERE key = 'clinical:charting_preferences'
  AND jsonb_typeof(value) = 'object'
  AND (
    value ?| ARRAY['crownSlaDays', 'bridgeSlaDays', 'implantSlaDays', 'dentureSlaDays']
    OR NOT (value ? 'defaultLabTurnaroundDays')
  );
