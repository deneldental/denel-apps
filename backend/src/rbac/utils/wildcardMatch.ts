/**
 * wildcardMatch — resolves wildcard permission strings
 *
 * A permission string can be:
 *   "patients:read"   — exact match
 *   "patients:*"      — matches all actions on the patients module
 *   "*:read"          — matches read on every module (not used in bundles, but supported)
 *   "*:*"             — matches everything (reserved for admin, but handled by bypass)
 *
 * Usage in bundles: bundle definitions use "module:*" to mean full CRUD.
 * At seed time, "module:*" expands to all known actions for that module.
 * At runtime, this utility checks if a resolved flat set covers a request.
 */

import { PERMISSION_DEFINITIONS } from '../../config/permissions.config'

export type ResolvedPermission = { module: string; action: string }

/**
 * Expand a wildcard permission string into concrete (module, action) pairs.
 * Uses the PERMISSION_DEFINITIONS list as the source of known permissions.
 *
 * "patients:*"  → [{ module: "patients", action: "read" }, { module: "patients", action: "create" }, ...]
 * "patients:read" → [{ module: "patients", action: "read" }]
 */
export function expandPermissionString(permString: string): ResolvedPermission[] {
  const [module, action] = permString.split(':')
  if (!module || !action) return []

  return PERMISSION_DEFINITIONS.filter((def) => {
    const moduleMatch = module === '*' || def.module === module
    const actionMatch = action === '*' || def.action === action
    return moduleMatch && actionMatch
  }).map((def) => ({ module: def.module, action: def.action }))
}

/**
 * Check if a flat permission set (array of "module:action" strings) covers
 * a specific (module, action) request.
 *
 * Handles wildcard entries in the set: if the set contains "patients:*" or
 * "*:read", those are matched correctly.
 */
export function permissionSetCovers(
  permissionSet: string[],
  module: string,
  action: string
): boolean {
  return permissionSet.some((entry) => {
    const [entryModule, entryAction] = entry.split(':')
    const moduleMatch = entryModule === '*' || entryModule === module
    const actionMatch = entryAction === '*' || entryAction === action
    return moduleMatch && actionMatch
  })
}

/**
 * Deduplicate and normalise a list of permission strings.
 */
export function deduplicatePermissions(permissions: ResolvedPermission[]): ResolvedPermission[] {
  const seen = new Set<string>()
  return permissions.filter(({ module, action }) => {
    const key = `${module}:${action}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Convert a ResolvedPermission array to a grouped map for the API response.
 * { "patients": ["read", "create", "update"], "appointments": ["read"] }
 */
export function groupPermissionsByModule(
  permissions: ResolvedPermission[]
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (const { module, action } of permissions) {
    if (!grouped[module]) grouped[module] = []
    if (!grouped[module].includes(action)) {
      grouped[module].push(action)
    }
  }
  return grouped
}
