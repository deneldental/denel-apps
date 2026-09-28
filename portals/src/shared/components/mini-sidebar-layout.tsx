import { Lock, PanelLeft, PanelLeftClose } from 'lucide-react'
import { type ComponentType, type ReactNode, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { usePermissions } from '@/lib/permissions-context'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'

export interface MiniSidebarItem {
  label: string
  to: string
  icon?: ComponentType<{ className?: string }>
  /** Optional short description shown on hover via `title`. */
  description?: string
  /**
   * When true, the item is active only when the current path exactly matches
   * `to` (not nested children). Use this for index/dashboard items that share
   * a prefix with their siblings (e.g. `/hr` vs `/hr/staff`, `/hr/requests`).
   */
  exact?: boolean
  /**
   * When set, the item renders in a locked state — greyed out, non-clickable,
   * with a lock icon and the reason in the tooltip. Use for features gated
   * behind a settings flag so users know the feature exists rather than
   * silently hiding the nav item.
   */
  disabledReason?: string
  /**
   * RBAC module slug required to see this item. If the user doesn't have this
   * module in their accessibleModules, the item is hidden from the mini-sidebar.
   * Omit for items that are always visible within the parent module.
   */
  permission?: string
  /**
   * When true, only admins see this item. Independent of `permission` — use it
   * for pages that are administrative by nature rather than permission-shaped
   * (e.g. App Payment Methods, the period-summary reports, Breakfast).
   *
   * Hiding the item is not a guard: wrap the route in `<AdminRoute>` too.
   */
  adminOnly?: boolean
}

interface MiniSidebarLayoutProps {
  /** Shown at the top of the mini-sidebar when expanded. */
  title: string
  items: MiniSidebarItem[]
  /**
   * Optional "current pathname matcher" — override to add custom active-route
   * logic (e.g. for a nested segment that should still highlight its parent).
   * Defaults to startsWith / exact match, and handles `?tab=*` query-param items.
   */
  matchActive?: (itemTo: string, currentPath: string, currentSearch: string) => boolean
  /** Initial collapsed state. Defaults to `false` (expanded). */
  defaultCollapsed?: boolean
  /**
   * Optional sticky header rendered above the outlet content. Used by the
   * Analytics layout to surface a global period filter + export action that
   * applies to every nested page.
   */
  headerSlot?: ReactNode
  /** Wraps the outlet so a layout can inject context providers. */
  children?: ReactNode
}

/**
 * Default active-state matcher. Handles three cases:
 *
 * 1. **Exact path match** — `/payments` vs `/payments`
 * 2. **Nested path** — `/expenses/2026/04/03` under `/expenses`
 * 3. **Query-param sub-items** — `/staff?tab=memos` matches only when both path
 *    and every specified query param agree. Pathname-only items (no `?`) must
 *    NOT match when the URL has a query that matches another item, so we bias
 *    toward the most specific: query-param items override the plain path when
 *    any query key/value matches.
 */
function defaultMatchActive(itemTo: string, currentPath: string, currentSearch: string): boolean {
  const qMark = itemTo.indexOf('?')
  if (qMark !== -1) {
    const itemPath = itemTo.slice(0, qMark)
    const itemParams = new URLSearchParams(itemTo.slice(qMark + 1))
    const currentParams = new URLSearchParams(currentSearch)
    return (
      currentPath === itemPath &&
      [...itemParams.entries()].every(([key, val]) => currentParams.get(key) === val)
    )
  }
  // Plain-path item: must match pathname exactly OR as a nested segment,
  // AND must not be overridden by a query-param sibling (caller controls).
  if (currentPath === itemTo) {
    // Exact path match — but if any query param is set, a sibling might own this tab.
    // We still return true; the mini-sidebar treats this as a "default/overview" click.
    return true
  }
  return currentPath.startsWith(`${itemTo}/`)
}

/**
 * Reusable layout for feature modules that use an internal mini-sidebar
 * (Finance, Clinical, Store, Scheduling, Staff). Mirrors the Settings page's
 * collapsible rail pattern:
 *
 * - **Desktop (≥lg):** 224px left rail expanded, 56px icons-only when collapsed.
 *   Toggle button in the rail header. Active state uses `bg-primary/10`.
 * - **Mobile (<lg):** horizontal chip row above the outlet, always expanded
 *   (collapse toggle is hidden — chips scroll horizontally if they overflow).
 *
 * Usage:
 * ```tsx
 * <Route element={<FinanceLayout />}>
 *   <Route path="/payments" element={<PaymentsLedgerPage />} />
 * </Route>
 * ```
 *
 * where `FinanceLayout` renders `<MiniSidebarLayout title="Finance" items={...} />`.
 */
function storageKey(title: string) {
  return `portal:mini-sidebar-collapsed:${title.toLowerCase().replace(/\s+/g, '-')}`
}

function readStoredCollapsed(title: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(storageKey(title))
    return v !== null ? v === 'true' : fallback
  } catch {
    return fallback
  }
}

export function MiniSidebarLayout({
  title,
  items,
  matchActive = defaultMatchActive,
  defaultCollapsed = true,
  headerSlot,
  children,
}: MiniSidebarLayoutProps) {
  const { pathname, search } = useLocation()
  const [collapsed, setCollapsed] = useState(() => readStoredCollapsed(title, defaultCollapsed))

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(storageKey(title), String(next))
      } catch {}
      return next
    })
  }
  const permissions = usePermissions()

  // Filter items by RBAC permission. Admin bypass → null (show all).
  const visibleItems = items.filter((item) => {
    if (item.adminOnly && !permissions?.isAdmin) return false
    if (!item.permission) return true
    if (!permissions || permissions.isAdmin) return true
    return permissions.accessibleModules.includes(item.permission)
  })

  // Compute which item is currently active. Three-pass:
  //   1. Items flagged `exact` win only on an exact path match — keeps a
  //      dashboard item (e.g. `/hr`) from staying active on `/hr/staff`.
  //   2. Any non-exact item whose matcher returns true.
  //   3. Fallback — if no item matched AND the current path equals an item's
  //      pathname (ignoring query), pick the first such item as the "default
  //      tab" (e.g. hitting /staff with no ?tab= highlights the first Staff
  //      item). This avoids pages having to redirect to their default tab.
  const activeKey = (() => {
    for (const item of items) {
      if (item.exact && item.to === pathname) return item.to
    }
    for (const item of items) {
      if (item.exact) continue
      if (matchActive(item.to, pathname, search)) return item.to
    }
    for (const item of items) {
      const itemPath = item.to.split('?')[0]
      if (itemPath === pathname) return item.to
    }
    return null
  })()

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* ── Mobile (<lg): horizontal chip row ──────────────────────────────── */}
      <nav
        aria-label={`${title} section navigation`}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/30 px-3 py-3 lg:hidden"
      >
        {visibleItems.map((item) => {
          const isActive = activeKey === item.to
          if (item.disabledReason) {
            return (
              <span
                key={item.to}
                title={item.disabledReason}
                aria-disabled="true"
                className="flex shrink-0 cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted-foreground/60"
              >
                {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
                <span>{item.label}</span>
                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
              </span>
            )
          }
          return (
            <Link
              key={item.to}
              to={item.to}
              title={item.description}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground'
              )}
            >
              {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* ── Desktop (≥lg): collapsible left rail ───────────────────────────── */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-in-out lg:flex',
          collapsed ? 'w-14' : 'w-56'
        )}
      >
        <div className="flex flex-col p-2">
          {/* Rail header — title + collapse toggle */}
          <div
            className={cn(
              'mb-2 flex items-center gap-3 rounded-lg px-2',
              collapsed ? 'justify-center' : 'justify-between'
            )}
          >
            {!collapsed && (
              <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {title}
              </h2>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleCollapsed}
              className="h-8 w-8 shrink-0"
              title={
                collapsed
                  ? `Expand ${title.toLowerCase()} sidebar`
                  : `Collapse ${title.toLowerCase()} sidebar`
              }
              aria-label={
                collapsed
                  ? `Expand ${title.toLowerCase()} sidebar`
                  : `Collapse ${title.toLowerCase()} sidebar`
              }
            >
              {collapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Nav items */}
          <ul className="space-y-0.5">
            {visibleItems.map((item) => {
              const isActive = activeKey === item.to
              const Icon = item.icon
              if (item.disabledReason) {
                return (
                  <li key={item.to}>
                    <span
                      title={
                        collapsed ? `${item.label} — ${item.disabledReason}` : item.disabledReason
                      }
                      aria-disabled="true"
                      className={cn(
                        'flex cursor-not-allowed items-center gap-3 rounded-lg py-2.5 text-sm font-medium text-muted-foreground/60',
                        collapsed ? 'justify-center px-0' : 'px-3'
                      )}
                    >
                      {Icon && <Icon className="h-4 w-4 shrink-0" />}
                      {!collapsed && (
                        <>
                          <span className="truncate flex-1">{item.label}</span>
                          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </>
                      )}
                    </span>
                  </li>
                )
              }
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    title={collapsed ? item.label : item.description}
                    className={cn(
                      'flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors',
                      collapsed ? 'justify-center px-0' : 'px-3',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0" />}
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </aside>

      {/* ── Content area ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {headerSlot && (
          <div className="shrink-0 border-b border-border bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/50">
            {headerSlot}
          </div>
        )}
        <div className="flex-1 overflow-auto">{children ?? <Outlet />}</div>
      </div>
    </div>
  )
}
