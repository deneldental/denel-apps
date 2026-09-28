import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Activity completions log — admin-v1 §1.1. The single source of truth for the
 * dashboard/CRM "Completed" tab. Marking any action item done (recare follow-up,
 * patient reminder, birthday greeting, unconfirmed appt, overdue invoice) writes a
 * row here; the Pending list is the live sources MINUS what's already logged. Both
 * the dashboard and the reminders/CRM surfaces write here via one shared mutation
 * (§3.3 / §13.1) so completions stay consistent everywhere.
 *
 * FK to user lives in the DB (migration 0113); column is plain here.
 */
export const activityCompletions = pgTable(
  'activity_completions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // 'recare' | 'patient_reminder' | 'birthday' | 'unconfirmed' | 'overdue'
    activityType: text('activityType').notNull(),
    refId: uuid('refId'), // source row id; null for purely-computed items
    label: text('label'), // display snapshot at completion time
    completedById: text('completedById'),
    completedAt: timestamp('completedAt').defaultNow().notNull(),
  },
  (t) => ({
    byType: index('activity_completions_type_idx').on(t.activityType, t.refId),
    byTime: index('activity_completions_time_idx').on(t.completedAt),
  })
)
