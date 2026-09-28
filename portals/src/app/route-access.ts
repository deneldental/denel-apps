import type { NavItem } from '@/app/modules/types'

// ── Which portal pages a user may open ────────────────────────────────────────
// Shared by the route guard (DashboardLayout) and the sidebar / mobile nav
// (getAllNavItems), so a link is only ever offered for a page the guard lets
// the user stay on. They used to decide separately: modules without a
// `permission` (Patient Records, Scheduling) were listed for everyone, and the
// guard then bounced every click on them back to the dashboard.

/** Where every signed-in portal user lands. The guard never bounces it. */
export const PORTAL_HOME = '/dashboard'

// Maps URL prefixes to their permission module name.
//
// This map must cover EVERY route registered through the module registry,
// because an unmapped path is DENIED rather than allowed (see
// `isPortalPathAllowed`). Only registry routes reach the guard — auth, kiosk,
// print views, public share links and the 404 all render outside
// DashboardLayout — so a new entry here is required whenever a module gains a
// route on a new prefix. Failing closed means forgetting one locks the page
// down (and hides its link); the old fail-open default silently published it.
export const PATH_MODULE_MAP: ReadonlyArray<{ prefix: string; module: string }> = [
  { prefix: '/dashboard', module: 'dashboard' },
  { prefix: '/patients', module: 'patients' },
  { prefix: '/appointments', module: 'appointments' },
  { prefix: '/activity', module: 'appointments' },
  { prefix: '/medical-records', module: 'medical_records' },
  { prefix: '/clinical', module: 'medical_records' },
  { prefix: '/ortho-consent', module: 'ortho_consent' },
  { prefix: '/consents', module: 'compliance' },
  { prefix: '/insurance', module: 'insurance' },
  { prefix: '/xrays', module: 'xrays' },
  { prefix: '/inventory', module: 'inventory' },
  { prefix: '/products', module: 'products' },
  { prefix: '/store', module: 'inventory' },
  { prefix: '/catalog', module: 'items' },
  { prefix: '/services', module: 'services' },
  { prefix: '/specialists', module: 'specialists' },
  { prefix: '/labs', module: 'labs' },
  // { prefix: '/documents', module: 'compliance' }, — Signed Documents is
  // unregistered until v3 (see app/modules/registry.ts); the route no longer
  // exists, so this entry has nothing to guard. Restore alongside the module.
  { prefix: '/payments', module: 'payments' },
  { prefix: '/payment-plans', module: 'payments' },
  { prefix: '/clinic-ledger', module: 'payments' },
  { prefix: '/invoices', module: 'payments' },
  { prefix: '/refunds', module: 'payments' },
  { prefix: '/expenses', module: 'expenses' },
  { prefix: '/petty-cash', module: 'expenses' },
  { prefix: '/financial-records', module: 'financial_records' },
  { prefix: '/financials', module: 'financial_records' },
  { prefix: '/bills', module: 'financial_records' },
  { prefix: '/deferred-revenue', module: 'financial_records' },
  { prefix: '/accounting', module: 'accounts' },
  { prefix: '/ledger-adjustments', module: 'ledger_adjustments' },
  { prefix: '/tax-calculations', module: 'tax_calculations' },
  { prefix: '/messaging', module: 'messaging' },
  { prefix: '/crm', module: 'messaging' },
  { prefix: '/hr', module: 'staff' },
  { prefix: '/staff', module: 'staff' },
  { prefix: '/compliance', module: 'compliance' },
  { prefix: '/analytics', module: 'analytics' },
  { prefix: '/reports', module: 'reports' },
  { prefix: '/my-reports', module: 'reports' },
  { prefix: '/settings', module: 'settings' },
  { prefix: '/users', module: 'users' },
  { prefix: '/roles', module: 'users' },
  { prefix: '/bundles', module: 'users' },
  { prefix: '/matrix', module: 'users' },
  { prefix: '/pwa-matrix', module: 'users' },
  { prefix: '/access-management', module: 'users' },
  { prefix: '/audit-logs', module: 'audit_logs' },
  { prefix: '/data-sync', module: 'sync' },
  { prefix: '/data-inject', module: 'data_inject' },
  { prefix: '/training', module: 'staff_training' },
  { prefix: '/integrations', module: 'integrations' },
  // ── Finance sub-pages on their own prefix ─────────────────────────────────
  // These sit under /finance/* rather than the top-level finance paths above,
  // so they matched nothing and were reachable by URL for any signed-in user.
  // Payroll Disbursal and Tax Configuration both rendered in full for a
  // receptionist; only the API's 403 kept the data back, and the pages showed
  // that denial as an ordinary empty state.
  { prefix: '/finance/payroll', module: 'payroll' },
  { prefix: '/finance/tax-configuration', module: 'tax_calculations' },
  { prefix: '/finance/payment-methods', module: 'financial_records' },
  // Redirect to /analytics/financial?tab=aging — mapped so the hop itself is
  // gated, not just its destination.
  { prefix: '/aging-report', module: 'analytics' },
  // External redirect to the HR app; gated like the /hr prefix above.
  { prefix: '/team', module: 'staff' },
]

// Longest prefix first, so '/finance/payroll' wins over a shorter match.
const SORTED_PATH_MODULE_MAP = [...PATH_MODULE_MAP].sort(
  (a, b) => b.prefix.length - a.prefix.length
)

/** The permission module guarding `pathname`, or null when no prefix maps it. */
export function getModuleForPath(pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0]
  const match = SORTED_PATH_MODULE_MAP.find((m) => path.startsWith(m.prefix))
  return match?.module ?? null
}

/**
 * May a user with `accessibleModules` stay on `pathname`? `null` means admin
 * (everything). The home page is always allowed; any other path must map to a
 * module the user can read — an unmapped path is denied, not published.
 */
export function isPortalPathAllowed(
  pathname: string,
  accessibleModules: readonly string[] | null
): boolean {
  if (accessibleModules === null) return true
  const path = pathname.split(/[?#]/)[0]
  if (path === PORTAL_HOME) return true
  const module = getModuleForPath(path)
  return module !== null && accessibleModules.includes(module)
}

/**
 * The nav items (and sub-items) a user may open — `isPortalPathAllowed` applied
 * to the sidebar and mobile nav. A group keeps only its reachable children and
 * disappears when none are left.
 */
export function navItemsAllowed(
  items: readonly NavItem[],
  accessibleModules: readonly string[] | null
): NavItem[] {
  return items.flatMap((item) => {
    if (!item.children?.length) {
      return isPortalPathAllowed(item.to, accessibleModules) ? [item] : []
    }
    const children = item.children.filter((c) => isPortalPathAllowed(c.to, accessibleModules))
    return children.length > 0 ? [{ ...item, children }] : []
  })
}
