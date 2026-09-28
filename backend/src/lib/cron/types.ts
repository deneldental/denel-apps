/**
 * Shared types for the cron registry + engines.
 */

export interface JobContext {
  /** Job id, useful for logging inside the handler. */
  jobId: string
  /** When the engine fired this run. */
  firedAt: Date
  /** Source that triggered the run. */
  source: 'node-cron' | 'qstash' | 'manual'
  /**
   * Engines call this to write a structured log line for the run. The
   * registry doesn't yet persist these — but handlers should still emit
   * one summary line via the standard logger.
   */
  log: (msg: string, extra?: Record<string, unknown>) => void
}

export interface CronJob {
  /** Stable id — used as the URL slug + QStash schedule id + lock key. */
  id: string
  /** Human description shown in the Integrations Cron UI. */
  description: string
  /** Standard 5-field cron expression. */
  cron: string
  /** Soft timeout for an individual run; engines may abort past this. */
  timeoutMs: number
  /** The work to do. Engines pass a JobContext for logging + observability. */
  handler: (ctx: JobContext) => Promise<JobRunResult | undefined>
}

export interface JobRunResult {
  /** Optional summary surfaced in the UI ("processed 12 reminders"). */
  summary?: string
  /** Optional structured payload — engines may persist this. */
  details?: Record<string, unknown>
}

export interface JobRunRecord {
  jobId: string
  startedAt: Date
  finishedAt: Date | null
  status: 'success' | 'failed' | 'skipped_locked'
  source: JobContext['source']
  summary: string | null
  error: string | null
}
