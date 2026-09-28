import { cn } from '@denel/utils'
import { Building2 } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useVisibleNav } from './use-visible-nav'

/** Mobile drawer navigation — flat list of HR_NAV links (feature-flag filtered). */
export function MobileNav({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const nav = useVisibleNav()

  return (
    <nav className="flex flex-col gap-1">
      <Link to="/dashboard" onClick={onNavigate} className="mb-2 flex items-center gap-2 px-2">
        <Building2 className="h-6 w-6" />
        <span className="font-semibold">Denel HR</span>
      </Link>
      {nav.map((item) => {
        const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`)
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-gray-200 font-medium text-gray-900 dark:bg-gray-700 dark:text-gray-50'
                : 'text-gray-600 hover:bg-muted dark:text-gray-300'
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
