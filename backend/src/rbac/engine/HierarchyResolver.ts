/**
 * HierarchyResolver — expands permission sets using the module hierarchy
 *
 * If a user has "patients:read", they implicitly also have:
 *   - "medical_records:read"
 *   - "ortho_consent:read"
 *   - "insurance:read"
 *
 * Hierarchy is defined in lib/modules.ts (MODULE_HIERARCHY) and shared with
 * the @denel/rbac package. This resolver uses that single source of truth.
 */

import { MODULE_HIERARCHY } from '../../lib/modules'
import type { ResolvedPermission } from '../utils/wildcardMatch'
import { deduplicatePermissions } from '../utils/wildcardMatch'

/**
 * Given a flat list of resolved permissions, expand it with all implied child
 * module permissions based on the MODULE_HIERARCHY.
 *
 * Example: input [{ module: 'patients', action: 'read' }]
 * Output:  [
 *   { module: 'patients', action: 'read' },
 *   { module: 'medical_records', action: 'read' },   ← implied
 *   { module: 'ortho_consent', action: 'read' },     ← implied
 *   { module: 'insurance', action: 'read' },         ← implied
 * ]
 */
export function expandWithHierarchy(permissions: ResolvedPermission[]): ResolvedPermission[] {
  const expanded: ResolvedPermission[] = [...permissions]

  for (const { module, action } of permissions) {
    const children = MODULE_HIERARCHY[module]?.children ?? []
    for (const childModule of children) {
      expanded.push({ module: childModule, action })
    }
  }

  return deduplicatePermissions(expanded)
}

/**
 * Check if a module is accessible given a set of permissions, accounting for
 * hierarchy — access to a parent module implies access to its children.
 */
export function isModuleAccessible(
  permissions: ResolvedPermission[],
  module: string,
  action: string
): boolean {
  // Direct match
  if (permissions.some((p) => p.module === module && p.action === action)) return true

  // Check if any parent module covers this child
  for (const [parent, config] of Object.entries(MODULE_HIERARCHY)) {
    if (config.children.includes(module)) {
      if (permissions.some((p) => p.module === parent && p.action === action)) {
        return true
      }
    }
  }

  return false
}
