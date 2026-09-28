/**
 * permissionDiff — compute before/after permission changes for audit logs
 *
 * Used when role bundles are modified or a user's role is changed.
 * Produces a human-readable diff for the audit trail.
 */

import type { ResolvedPermission } from './wildcardMatch'

export type PermissionDiff = {
  added: ResolvedPermission[]
  removed: ResolvedPermission[]
  unchanged: ResolvedPermission[]
}

/**
 * Compare two permission sets and return what was added, removed, and unchanged.
 */
export function diffPermissions(
  before: ResolvedPermission[],
  after: ResolvedPermission[]
): PermissionDiff {
  const beforeKeys = new Set(before.map((p) => `${p.module}:${p.action}`))
  const afterKeys = new Set(after.map((p) => `${p.module}:${p.action}`))

  const added = after.filter((p) => !beforeKeys.has(`${p.module}:${p.action}`))
  const removed = before.filter((p) => !afterKeys.has(`${p.module}:${p.action}`))
  const unchanged = before.filter((p) => afterKeys.has(`${p.module}:${p.action}`))

  return { added, removed, unchanged }
}

/**
 * Format a PermissionDiff as a human-readable summary string for audit logs.
 */
export function formatPermissionDiff(diff: PermissionDiff): string {
  const parts: string[] = []

  if (diff.added.length > 0) {
    const list = diff.added.map((p) => `${p.module}:${p.action}`).join(', ')
    parts.push(`Added: ${list}`)
  }

  if (diff.removed.length > 0) {
    const list = diff.removed.map((p) => `${p.module}:${p.action}`).join(', ')
    parts.push(`Removed: ${list}`)
  }

  if (parts.length === 0) return 'No changes'
  return parts.join(' | ')
}

/**
 * Compare two bundle ID arrays and return what changed.
 * Used when updating a role's bundle assignments.
 */
export function diffBundles(
  beforeBundleIds: string[],
  afterBundleIds: string[]
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(beforeBundleIds)
  const afterSet = new Set(afterBundleIds)

  return {
    added: afterBundleIds.filter((id) => !beforeSet.has(id)),
    removed: beforeBundleIds.filter((id) => !afterSet.has(id)),
  }
}
