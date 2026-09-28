import {
  Children,
  cloneElement,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import { navItemsAllowed } from '@/app/route-access'
import { AppErrorBoundary } from '@/shared/components/app-error-boundary'
import { accessManagementModule } from './access-management'
import { activityModule } from './activity'
import { analyticsModule } from './analytics'
import { auditModule } from './audit'
import { catalogModule } from './catalog'
import { clinicalModule } from './clinical'
import { complianceModule } from './compliance'
import { consentManagementModule } from './consent-management'
import { crmModule } from './crm'
import { dataInjectModule } from './data-inject'
import { doctorReportsModule } from './doctor-reports'
import { financeModule } from './finance'
import { insuranceModule } from './insurance'
import { integrationsModule } from './integrations'
import { inventoryModule } from './inventory'
import { labsModule } from './labs'
import { overviewModule } from './overview'
import { patientsModule } from './patients'
import { reportsModule } from './reports'
import { schedulingModule } from './scheduling'
import { servicesModule } from './services'
import { settingsModule } from './settings'
import { specialistsModule } from './specialists'
import { storeModule } from './store'
import type { Module, NavItem } from './types'
import { xraysModule } from './xrays'

/**
 * The single source of truth for all registered modules.
 * To add a new module: create its file in src/app/modules/, import it here, add to this array.
 */
export const modules: Module[] = [
  overviewModule, // order: 1
  patientsModule, // order: 2
  schedulingModule, // order: 3
  activityModule, // order: 3.5 — visit worklist (doctor day-sheet / reception billing lens)
  clinicalModule, // order: 4
  financeModule, // order: 5
  servicesModule, // order: 5.5 — price catalog
  specialistsModule, // order: 5.6 — re-homed from HR (HR-admin moved to the hr app)
  insuranceModule, // order: 6
  labsModule, // order: 7
  xraysModule, // order: 8
  reportsModule, // order: 9
  doctorReportsModule, // order: 9.1 — doctor's own weekly activity report
  inventoryModule, // order: 9.5
  catalogModule, // order: 9.6 — unified item catalog (§12.1)
  storeModule, // order: 10
  crmModule, // order: 11
  // staffModule + trainingModule removed — HR-admin + training authoring moved
  // to the standalone HR app (hr.deneldental.com). /hr/* redirects live in specialistsModule.
  accessManagementModule, // order: 12.8 — portal + PWA access hub
  complianceModule, // order: 13 — business/regulatory docs only
  // Signed Documents is hidden for EVERY role, admin included, pending v3.
  // Removed from the registry rather than gated: `adminOnly` would still leave
  // it in an admin's sidebar, and `disallowedRoles` is bypassed by admin
  // outright. Dropping the entry also unregisters the /documents route, so a
  // saved link can't reach a surface we've decided isn't ready.
  //
  // To restore in v3: re-add `documentsModule` here and its import above. The
  // module, its page and SubjectDocuments are all left intact.
  // documentsModule, // order: 13.2 — CC.4 signed-document records
  consentManagementModule, // order: 13.5 — patient consent workflows
  auditModule, // order: 14
  analyticsModule, // order: 15
  integrationsModule, // order: 16
  dataInjectModule, // order: 16.5
  settingsModule, // order: 17
]

/**
 * Returns all <Route> elements from every registered module, each wrapped in
 * a feature-scoped <AppErrorBoundary scope={moduleId}>.
 *
 * Rationale: a crash inside one module's page won't take down the entire portal —
 * only that module's main content area shows the error UI; sidebar + other
 * modules remain usable.
 *
 * The boundary wraps the route's `element` prop, not the <Route> itself
 * (react-router requires <Route> to be a direct child of <Routes>).
 *
 * For modules that use a mini-sidebar layout (nested <Route> children of a
 * parent layout route), we recurse into the children so each child route's
 * element gets its OWN boundary. This means a crash in one sub-page (e.g.
 * Payroll) falls back inside the Outlet while the layout's mini-sidebar
 * remains usable — it doesn't nuke the entire module.
 */
type RouteProps = { element?: ReactElement; children?: ReactNode }

function wrapRouteWithBoundary(route: ReactElement, scope: string): ReactElement {
  const props = (route as ReactElement<RouteProps>).props
  const updates: Partial<RouteProps> = {}

  if (props?.element) {
    updates.element = createElement(AppErrorBoundary as any, { scope }, props.element)
  }

  if (props?.children) {
    updates.children = Children.map(props.children, (child) =>
      isValidElement(child) ? wrapRouteWithBoundary(child, scope) : child
    )
  }

  if (Object.keys(updates).length === 0) return route
  return cloneElement(route as ReactElement<RouteProps>, updates)
}

export function getAllRoutes(): ReactElement[] {
  return modules.flatMap((m) => m.routes.map((route) => wrapRouteWithBoundary(route, m.id)))
}

/**
 * Returns all nav items sorted by module order, for use in the sidebar.
 * Pass `hiddenIds` to filter out specific modules (admin visibility settings).
 * Pass `accessibleModules` to filter by RBAC permissions; pass null to show all
 * (admin bypass — no filter applied).
 * Pass `roleId` to enforce `allowedRoles` restrictions on modules that share the
 * same permission bundles but need per-role gating (e.g. clinical for doctors only).
 */
export function getAllNavItems(
  hiddenIds: Set<string> = new Set(),
  accessibleModules: string[] | null = null,
  roleId: string | null = null,
  can?: (module: string, action: string) => boolean
): NavItem[] {
  // `accessibleModules === null` is the admin-bypass signal used throughout
  // this function, so it doubles as the admin test for `adminOnly` modules.
  const isAdmin = accessibleModules === null
  const checkCan = can || (() => true)
  const navItems = [...modules]
    .sort((a, b) => a.order - b.order)
    .filter((m) => !hiddenIds.has(m.id))
    .filter((m) => !m.adminOnly || isAdmin)
    .filter((m) => {
      if (!m.permission) return true
      if (accessibleModules === null) return true
      return accessibleModules.includes(m.permission)
    })
    .filter((m) => {
      if (m.disallowedRoles && roleId && m.disallowedRoles.includes(roleId)) return false
      if (m.hasAccess) return accessibleModules === null || m.hasAccess(checkCan)
      if (!m.allowedRoles) return true
      if (accessibleModules === null) return true // admin bypass
      if (!roleId) return false // roleId unknown → hide role-restricted modules
      return m.allowedRoles.includes(roleId)
    })
    .flatMap((m) => m.navItems)
  // Offer only links the route guard lets this user stay on — the guard and
  // the nav share route-access, so a listed link can never bounce back to the
  // dashboard.
  return navItemsAllowed(navItems, accessibleModules)
}
