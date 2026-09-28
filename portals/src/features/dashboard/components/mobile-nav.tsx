import markUrl from '@denel/assets/logo-icon.svg'
import { Link, useLocation } from 'react-router-dom'
import { getAllNavItems } from '@/app/modules/registry'
import type { NavItem, NavSubItem } from '@/app/modules/types'
import { useBranding } from '@/lib/branding-context'
import { usePermissions } from '@/lib/permissions-context'
import { cn } from '@/lib/utils'
import { useModuleVisibility } from '@/shared/hooks/use-module-visibility'

/**
 * Mobile navigation rendered inside the header's Sheet drawer.
 *
 * Unified with the desktop sidebar: both read from the module registry via
 * `getAllNavItems()`, so adding a new module automatically surfaces in both.
 *
 * Layout: a flat list of top-level items. If an item has `children`, they are
 * rendered as indented sub-links below the parent — no accordion on mobile to
 * keep the drawer scrollable and fast.
 *
 * `onNavigate` is called after any link click so the caller can close the Sheet.
 */
interface MobileNavProps {
  onNavigate: () => void
}

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

function MobileNavSubLink({
  item,
  pathname,
  search,
  onNavigate,
}: {
  item: NavSubItem
  pathname: string
  search: string
  onNavigate: () => void
}) {
  const isActive = isSubItemActive(item.to, pathname, search)
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      className={cn(
        'flex items-center rounded-md px-3 py-2 text-sm transition-colors',
        isActive
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {item.label}
    </Link>
  )
}

function MobileNavItem({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { pathname, search } = useLocation()
  const isSelfActive = pathname === item.to || pathname.startsWith(`${item.to}/`)
  const hasChildren = !!item.children?.length

  return (
    <div className="flex flex-col">
      <Link
        to={item.to}
        onClick={onNavigate}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-base transition-colors',
          isSelfActive && !hasChildren
            ? 'bg-muted font-medium text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        <span>{item.label}</span>
      </Link>
      {hasChildren && (
        <div className="ml-8 mt-0.5 space-y-0.5 border-l border-border/60 pl-3">
          {item.children?.map((child) => (
            <MobileNavSubLink
              key={child.to}
              item={child}
              pathname={pathname}
              search={search}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function MobileNav({ onNavigate }: MobileNavProps) {
  const { hiddenIds } = useModuleVisibility()
  const branding = useBranding()
  const permissions = usePermissions()

  // Same filtering the desktop sidebar applies — without it the drawer would
  // list modules (Analytics, CRM, Compliance…) the role can't open.
  // null = admin bypass (show all); [] = permissions not yet loaded.
  const accessibleModules = !permissions
    ? []
    : permissions.isAdmin
      ? null
      : permissions.accessibleModules
  const can = (mod: string, act: string) => {
    if (!permissions) return false
    if (permissions.isAdmin) return true
    return permissions.permissions?.[mod]?.includes(act) ?? false
  }
  const navItems = getAllNavItems(hiddenIds, accessibleModules, permissions?.roleId ?? null, can)

  return (
    <nav className="flex flex-col gap-1">
      <Link
        to="/dashboard"
        onClick={onNavigate}
        className="mb-4 flex items-center gap-2 text-lg font-semibold"
      >
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt="" className="h-6 w-6 rounded object-contain" />
        ) : (
          <img src={markUrl} alt="" aria-hidden="true" className="h-6 w-6" />
        )}
        <span>{branding.name}</span>
      </Link>
      {navItems.map((item) => (
        <MobileNavItem key={item.to} item={item} onNavigate={onNavigate} />
      ))}
    </nav>
  )
}
