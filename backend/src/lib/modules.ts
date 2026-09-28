// Re-exports from the canonical @denel/rbac package.
// Do not add constants here — edit packages/rbac/src/index.ts instead.

export type { Action, Module, Permission, Role, UserWithRole } from '@denel/rbac'
export {
  ACTIONS,
  can,
  getChildModules,
  getParentModule,
  isChildModule,
  isParentModule,
  MODULE_HIERARCHY,
  MODULES,
  ROLES,
} from '@denel/rbac'
export type { MenuItemConfig as MenuItemConfigType } from './menu-config'
// Menu config is backend-only (not shared with frontend packages).
export { MENU_ORDER, MenuItemConfig, MODULE_MENU_CONFIG } from './menu-config'
