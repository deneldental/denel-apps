import { useState } from 'react'
import { Header } from '@/features/dashboard/components/header'
import { Sidebar } from '@/features/dashboard/components/sidebar'
import { LoadingBar } from '@/shared/components/ui/loading-bar'

interface User {
  id: string
  email: string
  name: string
  roleId: string | null
  image?: string | null
}

interface DashboardShellProps {
  children: React.ReactNode
  user: User | null
  isLoading?: boolean
  permissions?: { isAdmin: boolean; accessibleModules: string[] } | null
}

export function DashboardShell({
  children,
  user,
  isLoading = false,
  permissions,
}: DashboardShellProps) {
  const [isCollapsed, setIsCollapsed] = useState(true)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-gray-100/40 dark:bg-gray-800/40 transition-all duration-300 print:block print:w-full print:h-auto">
      <LoadingBar isLoading={isLoading} />

      {/* Sidebar — fixed height, never scrolls */}
      <div
        className={`${isCollapsed ? 'w-[64px]' : 'w-[280px]'} shrink-0 h-full transition-all duration-300 print:hidden`}
      >
        <Sidebar
          isCollapsed={isCollapsed}
          toggleCollapse={() => setIsCollapsed(!isCollapsed)}
          user={user}
          permissions={permissions}
        />
      </div>

      {/* Main content — rounded left edge + shadow creates the inset/depth effect */}
      <div className="flex flex-col flex-1 min-h-0 bg-background rounded-l-2xl shadow-[-2px_0_12px_rgba(0,0,0,0.04)] print:w-full print:rounded-none print:shadow-none">
        <div className="shrink-0 print:hidden">
          <Header user={user} toggleSidebar={() => setIsCollapsed(!isCollapsed)} />
        </div>
        <main className="flex-1 overflow-y-auto print:p-0 print:m-0 print:w-full">{children}</main>
      </div>
    </div>
  )
}
