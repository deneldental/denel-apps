-- Cron job run history (observability for the cron engine layer).
-- One row per fired run, regardless of engine (node-cron / qstash / manual).

CREATE TABLE IF NOT EXISTS "cron_job_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "jobId" text NOT NULL,
  "source" text NOT NULL,
  "status" text NOT NULL,
  "summary" text,
  "errorMessage" text,
  "details" jsonb,
  "startedAt" timestamp NOT NULL,
  "finishedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cron_job_runs_job_started_idx"
  ON "cron_job_runs" ("jobId", "startedAt" DESC);
