import { cn } from '@denel/utils'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'

/**
 * BottomTabNav — the mobile PWA bottom tab bar (fixed, safe-area aware), with an
 * active-tab dot indicator and optional per-tab badge. Navigation is router-bound
 * (react-router `NavLink`), so this block takes `react-router-dom` as a peer dep;
 * the consuming app supplies the tab items (and any permission filtering).
 */

export interface BottomTabItem {
  label: string
  to: string
  icon: LucideIcon
  badge?: number | string
  /**
   * Optional permission gate. When set, the consuming layout filters the tab
   * out for users who lack `read` on this module (see usePermissions.canAccess).
   * Admin bypasses this check via PermissionEngine's admin override.
   */
  requiredModule?: string
}

export interface BottomTabNavProps {
  items: BottomTabItem[]
  ariaLabel?: string
  /**
   * NavLink `end` matching. `true` (default) → a tab is active only on an exact
   * path match; `false` → also active on sub-routes (keeps the tab lit on detail
   * pages nested under it).
   */
  end?: boolean
}

function shouldShowBadge(badge: number | string | undefined): boolean {
  if (badge === undefined || badge === null) return false
  if (typeof badge === 'number') return badge > 0
  return badge.length > 0
}

export function BottomTabNav({
  items,
  ariaLabel = 'Primary navigation',
  end = true,
}: BottomTabNavProps) {
  const tabs = items.slice(0, 6)
  return (
    <nav
      aria-label={ariaLabel}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex h-14 items-center gap-1.5 rounded-full border border-primary/10 bg-background/85 px-2 shadow-[0_8px_32px_rgba(36,41,106,0.12)] backdrop-blur-md"
    >
      {tabs.map((item) => {
        const Icon = item.icon
        const showBadge = shouldShowBadge(item.badge)
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={end}
            className="relative flex flex-none items-center justify-center no-underline transition-all duration-200"
          >
            {({ isActive }) => (
              <div
                className={cn(
                  'flex w-11 h-11 items-center justify-center rounded-full transition-all duration-200 shadow-xs',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-primary/5 text-primary/60 hover:text-primary hover:bg-primary/10'
                )}
              >
                <span className="relative inline-flex animate-fade-in">
                  <Icon
                    size={22}
                    strokeWidth={isActive ? 2.2 : 1.8}
                    fill="none"
                    className="transition-all duration-200"
                    aria-hidden="true"
                  />
                  {showBadge && (
                    <span className="absolute -top-1 -right-2 inline-flex min-w-[16px] h-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white bg-red-600">
                      {item.badge}
                    </span>
                  )}
                </span>
              </div>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
