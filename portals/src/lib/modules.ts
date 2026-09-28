/**
 * Re-exports all RBAC constants and helpers from @denel/rbac.
 * The source of truth has moved there — update this file if you need
 * mini-clinic-specific additions on top of the shared constants.
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
