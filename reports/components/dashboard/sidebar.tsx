import { Lock, Wallet } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { NAV_ITEMS } from '@/lib/menu'
import { useInjection } from '@/src/contexts/injection-context'

interface SidebarProps {
  isCollapsed: boolean
  toggleCollapse: () => void
}

export function Sidebar({ isCollapsed }: SidebarProps) {
  const { pathname } = useLocation()
  const { isEnabled, isLoading } = useInjection()

  return (
    <div className="hidden border-r bg-gray-100/40 lg:block dark:bg-gray-800/40 min-h-screen">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div
          className={`flex h-[60px] items-center border-b ${isCollapsed ? 'justify-center px-2' : 'px-6'}`}
        >
          <Link className="flex items-center gap-2 font-semibold" to="/overview">
            <Wallet className="h-6 w-6" />
            <span className={isCollapsed ? 'hidden' : ''}>Reports</span>
          </Link>
        </div>

        <div className="flex-1 overflow-auto py-2">
          <nav className="grid items-start px-2 text-sm font-medium">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
              const enabled = isEnabled(item.section)

              return (
                <Link
                  key={item.section}
                  to={item.href}
                  title={!isLoading && !enabled ? `${item.label} — not published` : undefined}
                  className={[
                    'flex items-center gap-3 rounded-lg px-3 py-2 transition-all',
                    isActive
                      ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-50 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50',
                    !isLoading && !enabled ? 'opacity-50' : '',
                    isCollapsed ? 'justify-center' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <item.icon className="h-4 w-4 shrink-0" />

                  {!isCollapsed && (
                    <>
                      <span className="flex-1">{item.label}</span>

                      {isLoading ? (
                        /* skeleton dot while config loads */
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-200 shrink-0 animate-pulse" />
                      ) : enabled ? (
                        /* published — green dot */
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                      ) : (
                        /* not published — lock icon */
                        <Lock className="h-3 w-3 shrink-0 text-gray-400" />
                      )}
                    </>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </div>
  )
}
