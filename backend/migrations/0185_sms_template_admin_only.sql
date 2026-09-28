-- SMS templates: admin-only visibility tag.
--
-- Marks a reminder template as visible to administrators only. Non-admins stop
-- seeing it everywhere templates are listed or picked (CRM > SMS Templates, and
-- the scheduling/reminder template selector), because the list endpoint filters
-- on this column for non-admin callers.
--
-- Defaults to false so every existing template keeps its current visibility.

ALTER TABLE "reminder_templates"
  ADD COLUMN IF NOT EXISTS "adminOnly" boolean DEFAULT false NOT NULL;
