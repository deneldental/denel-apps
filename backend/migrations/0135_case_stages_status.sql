-- 5.1 — add status lifecycle to case_stages
-- Valid values: planned | in_progress | completed | needs_review | cancelled
ALTER TABLE "case_stages"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'planned';
