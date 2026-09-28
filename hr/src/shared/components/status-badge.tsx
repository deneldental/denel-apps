import { Badge } from '@denel/ui'
import { cn } from '@denel/utils'
import type { ReactNode } from 'react'

/**
 * Status pills — the traffic-light half of the HR badge system.
 *
 * Every pill that communicates *state* (active/inactive, approved/pending,
 * paid/overdue, present/absent…) renders through here so the whole app speaks
 * one colour language: green = good/done, amber = in-progress/attention,
 * red = bad/blocked, grey = unknown/neutral. Tags (categories, roles,
 * departments) are the *other* half — see `TagBadge`, which is deliberately
 * multicoloured and never green/amber/red so the two systems never collide.
 */

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral'

const TONE_CLASSES: Record<StatusTone, string> = {
  success:
    'border-transparent bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  warning:
    'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  danger: 'border-transparent bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  neutral: 'border-transparent bg-muted text-muted-foreground',
}

// Keyword → tone. Matched against the normalized (lower-snake) status token, so
// "In Progress", "in_progress" and "IN PROGRESS" all resolve the same. Order
// doesn't matter — the sets are disjoint. Callers with an ambiguous or
// domain-specific value should pass an explicit `tone` instead of relying on
// inference (e.g. task priority, where "low" is neutral, not "good").
const SUCCESS =
  /^(active|approved|published|paid|present|complete|completed|passed|pass|verified|granted|resolved|done|success|succeeded|open|enabled|available|current|given|received|confirmed|accepted|in_stock|ok|good|early|on_time)$/
const WARNING =
  /^(pending|probation|draft|in_progress|processing|partial|review|in_review|under_review|on_leave|leave|late|excused|expiring|expiring_soon|scheduled|queued|awaiting|submitted|not_recorded|not_set|half|half_day|paused|hold|on_hold|running|due_soon)$/
const DANGER =
  /^(inactive|rejected|declined|failed|fail|absent|overdue|banned|unpaid|revoked|error|blocked|deleted|expired|suspended|auto_suspended|cancelled|canceled|disabled|denied|out_of_stock|missing|no_show|terminated|void)$/

/** Map an arbitrary status string to a traffic-light tone. */
export function statusTone(status: string | null | undefined): StatusTone {
  const s = String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (!s) return 'neutral'
  if (SUCCESS.test(s)) return 'success'
  if (WARNING.test(s)) return 'warning'
  if (DANGER.test(s)) return 'danger'
  return 'neutral'
}

interface StatusBadgeProps {
  /** The status value. Used for display and, when `tone` is omitted, inference. */
  status?: string | null
  /** Force a tone instead of inferring from the label. */
  tone?: StatusTone
  /** Custom content (defaults to the status text). */
  children?: ReactNode
  className?: string
}

/**
 * A status pill. Pass `status` to infer the colour, or `tone` to force it.
 *
 *   <StatusBadge status={run.status} />           // inferred
 *   <StatusBadge tone="success">Active</StatusBadge>
 */
export function StatusBadge({ status, tone, children, className }: StatusBadgeProps) {
  const resolved = tone ?? statusTone(status ?? (typeof children === 'string' ? children : ''))
  return (
    <Badge variant="outline" className={cn('capitalize', TONE_CLASSES[resolved], className)}>
      {children ?? (status ? status.replace(/_/g, ' ') : '—')}
    </Badge>
  )
}
