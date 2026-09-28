-- Lab case status-change history: one row per progress change, capturing who
-- changed it (user), from which surface (source = X-App-Id), and when. Powers the
-- audit table shown under the update-progress card in both the Team app and the
-- portal.
CREATE TABLE IF NOT EXISTS "lab_case_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "labCaseId" uuid NOT NULL REFERENCES "lab_cases"("id") ON DELETE CASCADE,
  "fromStatus" text,
  "toStatus" text NOT NULL,
  "changedById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "source" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_case_status_history_case_idx" ON "lab_case_status_history" ("labCaseId", "createdAt");
