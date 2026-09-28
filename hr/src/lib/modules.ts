/**
 * Re-exports RBAC constants/helpers from @denel/rbac so migrated portal
 * features that import from `@/lib/modules` keep working unchanged.
 */
export {
  ACTIONS,
  type Action,
  can,
  getChildModules,
  getParentModule,
  type InterfaceScope,
  isChildModule,
  isParentModule,
  MODULE_HIERARCHY,
  MODULES,
  type Module,
  type Permission,
  ROLE_SCOPES,
  ROLES,
  type Role,
  type UserWithRole,
} from '@denel/rbac'
