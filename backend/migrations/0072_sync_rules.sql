CREATE TABLE IF NOT EXISTS "sync_rules" (
  "entity" text PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "filter_custom" text,
  "filter_options" jsonb,
  "last_synced_at" timestamp,
  "records_synced" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
