/**
 * Aging buckets — pure helpers (testable, no DB).
 *
 * Bucket rules (matching industry-standard AR aging):
 *   current (0–30) : dueDate is missing OR daysOverdue <= 30
 *   31–60          : 31 <= daysOverdue <= 60
 *   61–90          : 61 <= daysOverdue <= 90
 *   90+            : daysOverdue > 90
 */

export type AgingBucket = 'current' | 'bucket30' | 'bucket60' | 'bucket90'

/**
 * Calculate whole days between two dates (dueDate and a reference day-of-month).
 * Both inputs are normalized to the start of the day so partial hours don't
 * skew the result.
 */
export function daysOverdue(dueDate: Date | null, today: Date): number {
  if (!dueDate) return 0
  const msPerDay = 1000 * 60 * 60 * 24
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const due = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
  return Math.floor((start.getTime() - due.getTime()) / msPerDay)
}

/**
 * Map an overdue-days value to a bucket.
 */
export function bucketFor(days: number): AgingBucket {
  if (days <= 30) return 'current'
  if (days <= 60) return 'bucket30'
  if (days <= 90) return 'bucket60'
  return 'bucket90'
}

/**
 * Convenience: given a due date + today, return the bucket.
 * A null dueDate is treated as "current" (not yet overdue).
 */
export function assignBucket(dueDate: Date | null, today: Date): AgingBucket {
  return bucketFor(daysOverdue(dueDate, today))
}
