import { Link, Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'Overview', to: '/access-management', exact: true },
  { label: 'Roles', to: '/roles', exact: false },
  { label: 'Bundles', to: '/bundles', exact: false },
  { label: 'Portal Matrix', to: '/matrix', exact: false },
  { label: 'PWA Matrix', to: '/pwa-matrix', exact: false },
  { label: 'Patient PWA', to: '/access-management/patients', exact: false },
  { label: 'Kiosk', to: '/access-management/kiosk', exact: false },
] as const

export function AccessLayout() {
  const { pathname } = useLocation()

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 pt-6">
        <h1 className="text-2xl font-bold tracking-tight">Access Management</h1>
        <p className="mt-0.5 mb-4 text-sm text-muted-foreground">
          Manage roles, permission bundles, and who can do what.
        </p>
        <nav className="-mb-px flex" aria-label="Access Management sections">
          {TABS.map(({ label, to, exact }) => {
            const active = exact
              ? pathname === to
              : pathname === to || pathname.startsWith(`${to}/`)
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'border-b-2 px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
                )}
              >
                {label}
              </Link>
            )
          })}
        </nav>
      </div>
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
