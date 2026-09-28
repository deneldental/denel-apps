import { History } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'

/**
 * §19.2 — reusable audit drill-down deep link.
 *
 * Renders a small "View audit history" control that links to the Audit Logs
 * page pre-filtered to a single entity (`/audit-logs?entityId=<id>`). Drop it
 * into any detail surface (patient, invoice, …) to give admins one-click access
 * to that record's full change history.
 *
 * Audit logs are admin-only; gate the render at the call site (e.g. `isAdmin`).
 */
export function ViewAuditHistoryLink({
  entityId,
  label = 'View audit history',
  variant = 'outline',
  size = 'sm',
  className,
}: {
  /** The audited entity's id (matches `audit_logs.entity_id`). */
  entityId: string
  label?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  className?: string
}) {
  return (
    <Button asChild variant={variant} size={size} className={cn(className)}>
      <Link to={`/audit-logs?entityId=${encodeURIComponent(entityId)}`}>
        <History className="mr-2 h-3.5 w-3.5" />
        {label}
      </Link>
    </Button>
  )
}
