import { ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { usePermissions } from '@/lib/permissions-context'

/**
 * Route-level admin gate.
 *
 * Modules hide admin-only entries from the sidebar via `adminOnly` (see
 * `app/modules/types.ts` and `MiniSidebarItem`), but a hidden nav item is not a
 * guard — the route still resolves if someone types or bookmarks the URL. Wrap
 * such routes in this component so non-admins get a clear refusal instead of
 * the page.
 *
 * Two usages:
 *   <Route element={<AdminRoute />}>…</Route>   // layout form, gates children
 *   <AdminRoute><SomePage /></AdminRoute>       // element form
 *
 * This is a UI gate. The backend still enforces its own checks — every
 * admin-only endpoint behind these pages does its own `isAdmin` / permission
 * check, and that remains the authority.
 */
export function AdminRoute({ children }: { children?: ReactNode }) {
  // Read the payload DashboardLayout already fetched rather than fetching again —
  // it only renders its children once that request has settled, so a null payload
  // here means the fetch failed, not that it is still in flight. Fail closed.
  const permissions = usePermissions()

  if (!permissions?.isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-sm space-y-3 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold">Administrator access only</h1>
          <p className="text-sm text-muted-foreground">
            This page is restricted to administrators. If you need it, ask an admin to grant access.
          </p>
        </div>
      </div>
    )
  }

  return <>{children ?? <Outlet />}</>
}
