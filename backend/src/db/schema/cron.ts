// Cron job run history. Every fired job — node-cron or QStash-triggered —
// records a row here so the Integrations UI can show last-run / status /
// error per job. Skipped-locked runs are recorded too so a quiet job is
// distinguishable from a hung job.

import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const cronJobRuns = pgTable('cron_job_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: text('jobId').notNull(),
  /** 'node-cron' | 'qstash' | 'manual' */
  source: text('source').notNull(),
  /** 'success' | 'failed' | 'skipped_locked' */
  status: text('status').notNull(),
  summary: text('summary'),
  errorMessage: text('errorMessage'),
  details: jsonb('details').$type<Record<string, unknown>>(),
  startedAt: timestamp('startedAt').notNull(),
  finishedAt: timestamp('finishedAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})
