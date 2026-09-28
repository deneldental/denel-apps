import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@denel/ui'
import { cn } from '@denel/utils'
import { Building2 } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import type { NavItem } from './nav'
import { useVisibleNav } from './use-visible-nav'

interface SidebarProps {
  isCollapsed: boolean
  toggleCollapse: () => void
}

const collapsedIconBase =
  'flex h-9 w-9 items-center justify-center rounded-lg transition-all shrink-0'

function isActive(to: string, pathname: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

function NavLink({ item, isCollapsed }: { item: NavItem; isCollapsed: boolean }) {
  const { pathname } = useLocation()
  const active = isActive(item.to, pathname)

  if (isCollapsed) {
    return (
      <div className="flex justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to={item.to}
              className={cn(
                collapsedIconBase,
                active
                  ? 'bg-gray-200 text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-50'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/60 dark:text-gray-400 dark:hover:text-gray-50 dark:hover:bg-gray-700/60'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      </div>
    )
  }

  return (
    <Link
      to={item.to}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
        active
          ? 'bg-gray-200 text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-50'
          : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50'
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span>{item.label}</span>
    </Link>
  )
}

export function Sidebar({ isCollapsed }: SidebarProps) {
  const nav = useVisibleNav()
  return (
    <TooltipProvider delayDuration={300}>
      <div className="hidden lg:flex flex-col h-full bg-gray-100/40 dark:bg-gray-800/40 border-r border-r-gray-200/60 dark:border-r-gray-700/40">
        {/* Logo */}
        <div
          className={cn(
            'flex h-[60px] items-center border-b border-b-gray-200/60 dark:border-b-gray-700/40 shrink-0',
            isCollapsed ? 'justify-center px-2' : 'px-4'
          )}
        >
          <Link className="flex items-center gap-2 min-w-0" to="/dashboard">
            <Building2 className="h-6 w-6 shrink-0" />
            {!isCollapsed && <span className="font-semibold text-sm truncate">Denel HR</span>}
          </Link>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-auto scrollbar-hide py-2">
          <nav className={cn('flex flex-col gap-0.5', isCollapsed ? 'px-2 items-center' : 'px-2')}>
            {nav.map((item) => (
              <NavLink key={item.to} item={item} isCollapsed={isCollapsed} />
            ))}
          </nav>
        </div>
      </div>
    </TooltipProvider>
  )
}
