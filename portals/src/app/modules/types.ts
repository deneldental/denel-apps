import type { ComponentType, ReactElement } from 'react'

export interface NavSubItem {
  label: string
  to: string
  icon?: ComponentType<{ className?: string }>
  permission?: { module: string; action: string }
}

export interface NavItem {
  label: string
  /** Used for active-state detection on the group header. For items with children,
   *  clicking the header only toggles the accordion — it does not navigate. */
  to: string
  icon: ComponentType<{ className?: string }>
  permission?: { module: string; action: string }
  children?: NavSubItem[]
}

export interface Module {
  id: string
  label: string
  /** Controls sidebar sort order. Lower numbers appear first. */
  order: number
  /** JSX <Route> elements contributed by this module to the protected route tree. */
  routes: ReactElement[]
  navItems: NavItem[]
  /** RBAC module slug required to see this nav entry. Omit for always-visible items. */
  permission?: string
  /**
   * When set, only users whose roleId is in this list can see this nav entry.
   * Admin (isAdmin=true) always bypasses this check.
   * Use when permission bundles don't distinguish the roles (e.g. doctor vs receptionist
   * both have `bundle_clinical_full`).
   */
  allowedRoles?: string[]
  /**
   * When set, users whose roleId is in this list cannot see this nav entry.
   * Useful to hide specific modules from certain roles (like hiding Finance from doctors).
   */
  disallowedRoles?: string[]
  /**
   * When true, only admins see this nav entry — regardless of the permission
   * bundles a role carries. Use for modules that are administrative by nature
   * (Compliance, Analytics, CRM) rather than permission-shaped.
   *
   * Hiding the nav entry is not a guard on its own: wrap the module's routes in
   * `<AdminRoute>` as well so a typed URL doesn't reach the page.
   */
  adminOnly?: boolean
  /**
   * Evaluates if the current user has access to this module based on permissions.
   * Supercedes allowedRoles and disallowedRoles to support custom roles natively.
   */
  hasAccess?: (can: (module: string, action: string) => boolean) => boolean
}
