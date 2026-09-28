import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { type AppRole, isGeneralStaffRole } from '@/shared/lib/role-routing'
import { RouteSkeleton } from './route-skeleton'

type RoleGate = AppRole | 'staff'

interface RequireRoleProps {
  roles: RoleGate[]
  children: ReactNode
}

/**
 * Route-level role guard. While auth is resolving, renders the route
 * skeleton — never the protected page chrome. After auth resolves, either
 * renders the children or redirects to /login.
 *
 * 'staff' is a meta-role that matches admin/receptionist/nurse/assistant/staff
 * — the general-purpose staff hub, not specialists like doctor/lab/trainer.
 *
 * Why this exists: without a route-level guard, layouts catch unauthorised
 * access AFTER the page chrome has already mounted, which can flash protected
 * content during the auth-context resolution window. This component blocks
 * the render until the context says yes.
 */
export function RequireRole({ roles, children }: RequireRoleProps) {
  const { user, loading: staffLoading } = useAuth()
  const location = useLocation()

  if (staffLoading) {
    return <RouteSkeleton />
  }

  if (user) {
    // user.roleId is the RBAC slug; user.role is Better Auth's coarser bucket.
    const userRole = (user.roleId ?? user.role) as string | undefined
    if (userRole) {
      const matches = roles.some((gate) => {
        if (gate === 'staff') return isGeneralStaffRole(userRole)
        return gate === userRole
      })
      if (matches) return <>{children}</>
    }
  }

  // Not authorised — redirect to login, remember where we were trying to go.
  return <Navigate to="/login" replace state={{ from: location.pathname }} />
}
