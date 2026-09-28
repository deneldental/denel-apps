-- admin-v1 §9.5 — rename the X-ray provenance column `source` → `origin`.
--
-- `xray_records.source` ('internal' | 'external') is purely a provenance label;
-- it collides terminologically with the GL `source_doc_type` and the
-- items/services `source` provenance, so it's renamed to `origin`. Values are
-- unchanged. Idempotent: only renames when the old `source` column still exists
-- and the new `origin` column does not, so re-running (or running after the
-- schema already matches) is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'xray_records' AND column_name = 'source'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'xray_records' AND column_name = 'origin'
  ) THEN
    ALTER TABLE "xray_records" RENAME COLUMN "source" TO "origin";
  END IF;
END $$;
