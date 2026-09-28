import { Button } from '@denel/ui'
import { Inbox, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Shared empty-state pattern: icon + headline + one line of context + optional CTA.
 * Use instead of a bare `<p>No X yet.</p>` so the app isn't dead-end blank screens.
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
