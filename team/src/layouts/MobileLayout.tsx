import { ClipboardList, FileText, GraduationCap, Home, Megaphone, TrendingUp } from 'lucide-react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { BrandLoader } from '@/shared/components/BrandLoader'

const tabs = [
  { to: '/dashboard', icon: Home, label: 'Home' },
  { to: '/requests', icon: FileText, label: 'Requests' },
  { to: '/training', icon: GraduationCap, label: 'Training' },
  { to: '/performance', icon: TrendingUp, label: 'Performance' },
  { to: '/memos', icon: Megaphone, label: 'Memos' },
  { to: '/tasks', icon: ClipboardList, label: 'Tasks' },
]

export default function MobileLayout() {
  const { user, loading } = useAuth()

  if (loading && !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <BrandLoader />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex flex-col h-full">
      {/* Main Content */}
      <main
        className="scroll-area flex-1"
        style={{
          paddingBottom: 'calc(var(--nav-height) + var(--safe-bottom))',
        }}
      >
        <Outlet />
      </main>

      {/* Bottom Tab Bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border grid"
        style={{
          gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
          height: 'calc(var(--nav-height) + var(--safe-bottom))',
          paddingBottom: 'var(--safe-bottom)',
        }}
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className="flex flex-col items-center gap-1 px-1 py-2 no-underline transition-colors"
          >
            {({ isActive }) => (
              <>
                <tab.icon
                  size={22}
                  strokeWidth={isActive ? 2.2 : 1.8}
                  className={cn(
                    'transition-colors',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )}
                />
                <span
                  className={cn(
                    'text-[0.62rem] transition-colors text-center leading-tight',
                    isActive ? 'text-foreground font-semibold' : 'text-muted-foreground font-normal'
                  )}
                >
                  {tab.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
