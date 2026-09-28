import { RouteSkeleton } from '@denel/app-kit'
import { Suspense, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useLoading } from '@/lib/loading-context'
import { LoadingBar } from '@/shared/components/loading-bar'
import { Header } from './header'
import { Sidebar } from './sidebar'

/**
 * HR app shell — ported from portal's DashboardShell. Collapsible sidebar +
 * header + top loading bar, with the page rendered via <Outlet />.
 */
export function HrLayout() {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const { isLoading } = useLoading()
  const { user } = useAuth()

  return (
    <div className="flex h-screen w-full overflow-hidden bg-gray-100/40 dark:bg-gray-800/40 transition-all duration-300 print:block print:w-full print:h-auto">
      <LoadingBar isLoading={isLoading} />

      {/* Sidebar — fixed height, never scrolls */}
      <div
        className={`${isCollapsed ? 'w-[64px]' : 'w-[280px]'} shrink-0 h-full transition-all duration-300 print:hidden`}
      >
        <Sidebar isCollapsed={isCollapsed} toggleCollapse={() => setIsCollapsed(!isCollapsed)} />
      </div>

      {/* Main content — rounded left edge + shadow creates the inset/depth effect */}
      <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-gray-950 rounded-l-2xl shadow-[-2px_0_12px_rgba(0,0,0,0.04)] print:w-full print:rounded-none print:shadow-none">
        <div className="shrink-0 print:hidden">
          <Header user={user} toggleSidebar={() => setIsCollapsed(!isCollapsed)} />
        </div>
        <main className="flex-1 overflow-y-auto print:p-0 print:m-0 print:w-full">
          {/* Lazily-loaded route chunks resolve here; the skeleton covers the
              fetch so there's no flash of empty content. */}
          <Suspense fallback={<RouteSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
