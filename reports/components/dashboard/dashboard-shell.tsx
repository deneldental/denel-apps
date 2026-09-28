import { useState } from 'react'
import { Header } from '@/components/dashboard/header'
import { Sidebar } from '@/components/dashboard/sidebar'

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
}

export function DashboardShell({ children, user }: DashboardShellProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div
      className={`grid min-h-screen w-full transition-all duration-300 ${isCollapsed ? 'grid-cols-[80px_1fr]' : 'lg:grid-cols-[280px_1fr]'} print:block print:w-full print:h-auto`}
    >
      <div className="print:hidden">
        <Sidebar isCollapsed={isCollapsed} toggleCollapse={() => setIsCollapsed(!isCollapsed)} />
      </div>
      <div className="flex flex-col print:w-full">
        <div className="print:hidden">
          <Header user={user} toggleSidebar={() => setIsCollapsed(!isCollapsed)} />
        </div>
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 print:p-0 print:m-0 print:w-full">
          {children}
        </main>
      </div>
    </div>
  )
}
