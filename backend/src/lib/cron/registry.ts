/**
 * Cron job registry.
 *
 * Every scheduled task in the system is registered here as a declarative
 * `CronJob`. The cron engine layer (node-cron or QStash) consumes this
 * registry — engines never know what a job *does*, just when to fire it.
 *
 * To add a new scheduled task:
 *   1. Write its handler in `backend/src/lib/cron/jobs/<name>.ts`
 *   2. Append a `defineJob(...)` entry below
 *
 * Engines re-read this list on boot and on integration save.
 */

// Handlers are imported statically below — one named import per job file.
// Each registry entry references its handler directly.
import { runAgingDigest } from './jobs/aging-digest'
import { runAuditRetention } from './jobs/audit-retention'
import { runBackup } from './jobs/backup'
import { runComplianceRenewalReminders } from './jobs/compliance-renewal-reminders'
import { runCrmAutoQueueJob } from './jobs/crm-autoqueue'
import { runLabTwoWeekFallback } from './jobs/lab-fallback'
import { runLatenessPolicy } from './jobs/lateness-policy'
import { runNoShowAutoMark } from './jobs/no-show-auto-mark'
import { runOtpSessionCleanup } from './jobs/otp-session-cleanup'
import { runPaymentPlanOverdue } from './jobs/payment-plan-overdue'
import { runPushSubscriptionCleanup } from './jobs/push-cleanup'
import { runRecareBatch } from './jobs/recare-batch'
import { runSchedulerTick } from './jobs/scheduler-tick'
import { runTaskReminders } from './jobs/task-reminders'
import type { CronJob, JobContext } from './types'

function defineJob(job: CronJob): CronJob {
  return job
}

export const CRON_JOBS: readonly CronJob[] = [
  defineJob({
    id: 'scheduler-tick',
    description:
      'Every 15 minutes: scheduled reminders, credential/document expiry checks, birthday SMS.',
    cron: '*/15 * * * *',
    handler: (ctx: JobContext) => runSchedulerTick(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'backup-daily',
    description:
      'Daily database backup (pg_dump → gzip → object storage). Time follows the Backup config schedule.',
    cron: '0 18 * * *',
    handler: (ctx: JobContext) => runBackup(ctx),
    timeoutMs: 30 * 60 * 1000,
  }),
  defineJob({
    id: 'lab-fallback-daily',
    description:
      'Marks lab cases as expense-ready after 14 days even if no patient payment arrived. Prevents external lab bills from being silently skipped.',
    cron: '0 1 * * *',
    handler: (ctx: JobContext) => runLabTwoWeekFallback(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'otp-session-cleanup',
    description:
      'Deletes expired OTP codes and stale patient/staff sessions. Stops the auth tables from growing unbounded.',
    cron: '0 2 * * *',
    handler: (ctx: JobContext) => runOtpSessionCleanup(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'push-cleanup-weekly',
    description:
      'Purges push subscriptions that have errored repeatedly. Keeps the dispatch fanout lean.',
    cron: '0 3 * * 0',
    handler: (ctx: JobContext) => runPushSubscriptionCleanup(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'payment-plan-overdue',
    description:
      'Detects payment-plan installments that crossed their due date and marks them overdue + emits a reminder for the receptionist.',
    cron: '0 4 * * *',
    handler: (ctx: JobContext) => runPaymentPlanOverdue(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'audit-retention-monthly',
    description:
      'Purges audit_logs older than 365 days and login_attempts older than 30 days. Keeps the security tables responsive without losing the investigation window.',
    cron: '0 5 1 * *',
    handler: (ctx: JobContext) => runAuditRetention(ctx),
    timeoutMs: 10 * 60 * 1000,
  }),
  defineJob({
    id: 'aging-digest-daily',
    description:
      'Mon-Fri 7am: emails an AR aging summary (current / 31-60 / 61-90 / 90+) + top 10 debtors to every user with financial_records:read.',
    cron: '0 7 * * *',
    handler: (ctx: JobContext) => runAgingDigest(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'recare-batch-nightly',
    description:
      'Scans recare_plans due in the next 3 days and queues SMS via scheduled_reminders (the 15-min tick dispatches at the right time). Idempotent on (patient, day).',
    cron: '0 23 * * *',
    handler: (ctx: JobContext) => runRecareBatch(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'no-show-auto-mark',
    description:
      "Daily 5am: marks appointments past their date >24h ago as 'no_show' if still open. Doesn't delete — keeps the row for reporting.",
    cron: '0 5 * * *',
    handler: (ctx: JobContext) => runNoShowAutoMark(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'compliance-renewal-reminders',
    description:
      'Daily 8am: SMS-reminds the configured phones for compliance documents entering their reminder window (N months before expiry). Fires once per renewal cycle (admin-v1 §17.2).',
    cron: '0 8 * * *',
    handler: (ctx: JobContext) => runComplianceRenewalReminders(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'lateness-policy-weekly',
    description:
      'Monday 6am: flags attendance-tracked staff who were late ≥ threshold times the prior week and issues the next escalating lateness query (SMS; level-2 also files an HR admin task). Idempotent per staff/week.',
    cron: '0 6 * * 1',
    handler: (ctx: JobContext) => runLatenessPolicy(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'task-reminders',
    description:
      'Daily 7:30am: re-notifies assignees of still-open repeating tasks (daily/weekly cadence) via SMS + Web Push. One-off tasks and completed assignments are never reminded.',
    cron: '30 7 * * *',
    handler: (ctx: JobContext) => runTaskReminders(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
  defineJob({
    id: 'crm-autoqueue',
    description:
      "Daily 6am: queues the day's birthday + follow-up sends into scheduled_reminders with requiresConfirmation=true (staff confirm before send). Idempotent per (patient, kind, day) (admin-v1 §13.2).",
    cron: '0 6 * * *',
    handler: (ctx: JobContext) => runCrmAutoQueueJob(ctx),
    timeoutMs: 5 * 60 * 1000,
  }),
]

export function getJob(id: string): CronJob | undefined {
  return CRON_JOBS.find((j) => j.id === id)
}
