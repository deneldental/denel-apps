import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/components/ui/button'

/**
 * Shared empty-state pattern.
 *
 * Every empty state across the portal should have:
 *   1. An icon (so the eye knows where to start)
 *   2. A short headline ("what's missing")
 *   3. One sentence of context ("why it might be missing" — not a generic apology)
 *   4. Optional primary CTA — the action that creates the missing thing
 *
 * Pages that previously rendered a single `<p>No X yet.</p>` should adopt
 * this so HR isn't staring at dead-end blank screens.
 *
 * Example:
 * ```tsx
 * <EmptyState
 *   icon={Inbox}
 *   title="No pending requests"
 *   description="Nothing waiting on your approval right now."
 * />
 * <EmptyState
 *   icon={UserPlus}
 *   title="No staff yet"
 *   description="Add your first staff member to start tracking attendance, payroll, and credentials."
 *   action={{ label: 'Add staff', onClick: handleAdd }}
 * />
 * ```
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  children,
  className = '',
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
    variant?: 'default' | 'outline' | 'secondary'
  }
  /** Optional slot for a custom CTA / additional links below the action button. */
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 py-12 text-center ${className}`}
    >
      <div className="rounded-full bg-muted p-3">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && (
        <Button
          size="sm"
          variant={action.variant ?? 'default'}
          onClick={action.onClick}
          className="mt-2"
        >
          {action.label}
        </Button>
      )}
      {children}
    </div>
  )
}
