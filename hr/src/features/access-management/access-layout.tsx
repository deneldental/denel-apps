import { cn } from '@denel/utils'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Suspense } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { usePermissions } from '@/shared/hooks/use-permissions'

// Tabbed shell for the HR Access Management section (ported from portal). RBAC
// admin (roles, the permission matrix, bundles) is admin-only on the backend
// (`/api/roles/*` checks roleId === 'admin'), so the whole section is gated to
// admins; non-admins get a clear "not authorized" message instead of 403 walls.

const TABS = [
  { to: '/access-management', label: 'Overview', end: true },
  { to: '/access-management/roles', label: 'Roles' },
  { to: '/access-management/bundles', label: 'Bundles' },
  { to: '/access-management/matrix', label: 'Portal Matrix' },
  { to: '/access-management/pwa-matrix', label: 'PWA Matrix' },
]

export function AccessLayout() {
  const { isAdmin, isLoading } = usePermissions()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground/40" />
        <h1 className="text-xl font-bold">Admin only</h1>
        <p className="text-sm text-muted-foreground">
          Managing roles, permissions, and bundles requires the Admin role. Ask an administrator if
          you need access changed.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Access Management</h1>
        <p className="text-muted-foreground mt-1">
          Roles, the role × module permission matrix, and permission bundles.
        </p>
      </div>

      <div className="border-b">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.end ? location.pathname === t.to : location.pathname.startsWith(t.to)
            return (
              <Link
                key={t.to}
                to={t.to}
                className={cn(
                  'whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                )}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <Suspense
        fallback={
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </div>
  )
}
