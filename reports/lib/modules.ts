/**
 * Re-exports all RBAC constants and helpers from @denel/rbac.
 * The source of truth has moved there.
 */
export {
  ACTIONS,
  type Action,
  can,
  getChildModules,
  getParentModule,
  isChildModule,
  isParentModule,
  MODULE_HIERARCHY,
  MODULES,
  type Module,
  type Permission,
  ROLES,
  type Role,
  type UserWithRole,
} from '@denel/rbac'
