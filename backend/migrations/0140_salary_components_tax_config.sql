-- §4.2 salary_components.taxConfigId — optional FK to tax_configurations
-- Allows a per-component tax type (PAYE, WHT_Services, exempt, etc.)
-- taxable boolean is retained as a derived shorthand for existing callers.

ALTER TABLE salary_components
  ADD COLUMN IF NOT EXISTS "taxConfigId" uuid
    REFERENCES tax_configurations(id) ON DELETE SET NULL;
