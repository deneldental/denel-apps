import markUrl from '@denel/assets/logo-icon.svg'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getAllNavItems } from '@/app/modules/registry'
import type { NavItem, NavSubItem } from '@/app/modules/types'
import { useBranding } from '@/lib/branding-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip'
import { useModuleVisibility } from '@/shared/hooks/use-module-visibility'

interface SidebarProps {
  isCollapsed: boolean
  toggleCollapse: () => void
  user: { roleId: string | null } | null
  permissions?: { isAdmin: boolean; accessibleModules: string[]; roleId?: string | null } | null
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

// Shared style for the square icon button in collapsed mode
const collapsedIconBase =
  'flex h-9 w-9 items-center justify-center rounded-lg transition-all shrink-0'

// Checks whether a nav sub-item `to` URL matches the current location.
// Handles query-param sub-items (e.g. "/staff?tab=memos") by comparing
// both pathname and search params, not just the pathname.
function isSubItemActive(to: string, pathname: string, search: string): boolean {
  const qMark = to.indexOf('?')
  if (qMark !== -1) {
    const itemPath = to.slice(0, qMark)
    const itemParams = new URLSearchParams(to.slice(qMark + 1))
    const currentParams = new URLSearchParams(search)
    return (
      pathname === itemPath &&
      [...itemParams.entries()].every(([key, val]) => currentParams.get(key) === val)
    )
  }
  return pathname === to || pathname.startsWith(`${to}/`)
}

// ─── Sub-item link (expanded accordion) ──────────────────────────────────────

function NavSubLink({ item, pathname }: { item: NavSubItem; pathname: string }) {
  const { search } = useLocation()
  const isActive = isSubItemActive(item.to, pathname, search)
  return (
    <Link
      to={item.to}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        isActive
          ? 'bg-gray-200 text-gray-900 font-medium dark:bg-gray-700 dark:text-gray-50'
          : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50'
      )}
    >
      {item.label}
    </Link>
  )
}

// ─── Collapsed: direct link ───────────────────────────────────────────────────
// Hover → tooltip anchored to right edge with arrow. Click → navigate.

function CollapsedDirectLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation()
  const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={item.to}
          className={cn(
            collapsedIconBase,
            isActive
              ? 'bg-gray-200 text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-50'
              : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/60 dark:text-gray-400 dark:hover:text-gray-50 dark:hover:bg-gray-700/60'
          )}
        >
          <item.icon className="h-4 w-4 shrink-0" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

// ─── Collapsed: group with children ──────────────────────────────────────────
// Hover → tooltip with group label anchored to right edge with arrow.
// Click → DropdownMenu flyout listing all children.

function CollapsedGroupMenu({ item }: { item: NavItem }) {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()

  const isChildActive = item.children?.some((c) => isSubItemActive(c.to, pathname, search))

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                collapsedIconBase,
                isChildActive
                  ? 'bg-gray-200 text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-50'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/60 dark:text-gray-400 dark:hover:text-gray-50 dark:hover:bg-gray-700/60'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-48">
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {item.label}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {item.children?.map((child) => {
          const isActive = isSubItemActive(child.to, pathname, search)
          return (
            <DropdownMenuItem
              key={child.to}
              onSelect={() => navigate(child.to)}
              className={cn(
                'cursor-pointer',
                isActive && 'bg-accent text-accent-foreground font-medium'
              )}
            >
              {child.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Nav group ────────────────────────────────────────────────────────────────

function NavGroup({ item, isCollapsed }: { item: NavItem; isCollapsed: boolean }) {
  const { pathname, search } = useLocation()

  const isChildActive = item.children?.some((c) => isSubItemActive(c.to, pathname, search))
  const isSelfActive =
    !item.children && (pathname === item.to || pathname.startsWith(`${item.to}/`))

  const [open, setOpen] = useState(isChildActive ?? false)

  useEffect(() => {
    if (isChildActive) setOpen(true)
  }, [isChildActive])

  // ── Collapsed ─────────────────────────────────────────────────────────────
  if (isCollapsed) {
    return (
      <div className="flex justify-center">
        {item.children?.length ? (
          <CollapsedGroupMenu item={item} />
        ) : (
          <CollapsedDirectLink item={item} />
        )}
      </div>
    )
  }

  // ── Expanded: direct link ─────────────────────────────────────────────────
  if (!item.children?.length) {
    return (
      <Link
        to={item.to}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 transition-all',
          isSelfActive
            ? 'bg-gray-200 text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-50'
            : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50'
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span>{item.label}</span>
      </Link>
    )
  }

  // ── Expanded: collapsible accordion ───────────────────────────────────────
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-all text-sm font-medium',
          isChildActive
            ? 'text-gray-900 dark:text-gray-50'
            : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50'
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-200 text-gray-400',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="ml-7 mt-0.5 mb-1 space-y-0.5 border-l border-l-gray-200/50 dark:border-l-gray-700/30 pl-3">
          {item.children.map((child) => (
            <NavSubLink key={child.to} item={child} pathname={pathname} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar({ isCollapsed, permissions }: SidebarProps) {
  const branding = useBranding()
  const { hiddenIds } = useModuleVisibility()

  // null = admin bypass (show all); [] = permissions not yet loaded (hide filtered items)
  const accessibleModules = !permissions
    ? []
    : permissions.isAdmin
      ? null
      : permissions.accessibleModules
  // Admins keep the `accessibleModules === null` bypass for `allowedRoles`, but we
  // still pass their real roleId so `disallowedRoles` can exclude role-specific
  // duplicates from the admin sidebar (e.g. the doctor-only Reports page).
  const roleId = !permissions ? null : (permissions.roleId ?? null)
  const can = (mod: string, _act: string) => {
    if (!permissions) return false
    if (permissions.isAdmin) return true
    return permissions.accessibleModules?.includes(mod) ?? false
  }
  const navItems = getAllNavItems(hiddenIds, accessibleModules, roleId, can)

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
            {!isCollapsed && branding.logoHorizontalUrl ? (
              // Expanded, with a horizontal logo uploaded (Brand Assets):
              // the wordmark replaces icon + name, as the tab's preview shows.
              <img
                src={branding.logoHorizontalUrl}
                alt={branding.shortName || 'Clinic'}
                className="h-8 max-w-[180px] object-contain object-left"
              />
            ) : (
              <>
                {branding.logoIconUrl ? (
                  <img
                    src={branding.logoIconUrl}
                    alt=""
                    className={cn('object-contain shrink-0', isCollapsed ? 'h-8 w-8' : 'h-7 w-7')}
                  />
                ) : (
                  // The Denel mark, not a stock icon. Only an admin-uploaded
                  // logoIconUrl overrides it.
                  <img src={markUrl} alt="" aria-hidden="true" className="h-6 w-6 shrink-0" />
                )}
                {!isCollapsed && (
                  <span className="font-semibold text-sm truncate">
                    {branding.shortName || 'Clinic'}
                  </span>
                )}
              </>
            )}
          </Link>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-auto scrollbar-hide py-2">
          <nav className={cn('flex flex-col gap-0.5', isCollapsed ? 'px-2 items-center' : 'px-2')}>
            {navItems.map((item) => (
              <NavGroup key={item.to} item={item} isCollapsed={isCollapsed} />
            ))}
          </nav>
        </div>
      </div>
    </TooltipProvider>
  )
}
