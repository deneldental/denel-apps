/**
 * Re-exports RBAC constants/helpers from @denel/rbac so migrated portal
 * features that import from `@/lib/modules` keep working unchanged.
 */
export {
  ACTIONS,
  type Action,
  assignableRoleIds,
  can,
  canDelegateRoleChange,
  getChildModules,
  getParentModule,
  HR_ASSIGNABLE_ROLES,
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
  roleSignsInWithPassword,
  type UserWithRole,
} from '@denel/rbac'
