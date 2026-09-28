import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { staff } from './staff'

/**
 * Tasks Management — general (non-lifecycle) task assignment. HR assigns a task
 * to one or many staff (or to themselves); each assignee is tracked + notified
 * individually (SMS + Web Push). Distinct from `staff_lifecycle_tasks`, which is
 * bound to onboarding/offboarding templates.
 */
export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  /** 'low' | 'normal' | 'high' | 'urgent' */
  priority: text('priority').notNull().default('normal'),
  dueAt: timestamp('dueAt'),
  /** 'none' | 'daily' | 'weekly' — re-notify cadence for open assignments. */
  repeat: text('repeat').notNull().default('none'),
  createdByUserId: text('createdByUserId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const taskAssignments = pgTable(
  'task_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('taskId')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    // Exactly one of staffId / userId identifies the assignee:
    //  - staffId: a staff member — notified via SMS + push, completes in the PWA.
    //  - userId:  an HR admin's self-assigned task — seen in "My Tasks" in the HR app.
    staffId: uuid('staffId').references(() => staff.id, { onDelete: 'cascade' }),
    userId: text('userId').references(() => user.id, { onDelete: 'cascade' }),
    /** 'pending' | 'done' */
    status: text('status').notNull().default('pending'),
    doneAt: timestamp('doneAt'),
    notifiedAt: timestamp('notifiedAt'),
    lastReminderAt: timestamp('lastReminderAt'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    taskIdx: index('task_assignments_taskId_idx').on(t.taskId),
    staffIdx: index('task_assignments_staffId_idx').on(t.staffId),
    userIdx: index('task_assignments_userId_idx').on(t.userId),
  })
)
