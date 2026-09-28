import type { ReactNode } from 'react'
import { usePermissions } from '@/shared/hooks/use-permissions'

interface PermissionGuardProps {
  /** Permission module (e.g. 'payments', 'medical_records'). */
  module: string
  /** Permission action — defaults to 'read'. */
  action?: string
  /** Rendered when the user has the permission. */
  children: ReactNode
  /** Rendered when the user lacks the permission. Defaults to null (hidden). */
  fallback?: ReactNode
  /** If true, renders `children` during the initial permission fetch.
   * Defaults to false (hide during loading for safer UX). */
  renderWhileLoading?: boolean
}

/**
 * Gates UI based on the current user's RBAC permissions.
 *
 * Usage:
 *   <PermissionGuard module="payments" action="create">
 *     <RecordPaymentButton />
 *   </PermissionGuard>
 *
 * With fallback:
 *   <PermissionGuard module="staff" action="delete" fallback={<ReadOnlyBadge />}>
 *     <DeleteStaffButton />
 *   </PermissionGuard>
 *
 * Notes:
 * - Backed by /api/auth/permissions (fetched once at mount by `usePermissions`).
 * - Admins bypass all checks (handled by the hook).
 * - This is a UI-gate only. Backend routes MUST enforce `checkPermission` too.
 */
export function PermissionGuard({
  module,
  action = 'read',
  children,
  fallback = null,
  renderWhileLoading = false,
}: PermissionGuardProps) {
  const { hasPermission, isLoading } = usePermissions()

  if (isLoading) {
    return renderWhileLoading ? children : fallback
  }

  return hasPermission(module, action) ? children : fallback
}

/**
 * Inverse of PermissionGuard — renders children ONLY if user LACKS the permission.
 * Useful for "Request access" CTAs.
 */
export function PermissionDenied({
  module,
  action = 'read',
  children,
}: Omit<PermissionGuardProps, 'fallback' | 'renderWhileLoading'>) {
  const { hasPermission, isLoading } = usePermissions()
  if (isLoading) return null
  return hasPermission(module, action) ? null : children
}
