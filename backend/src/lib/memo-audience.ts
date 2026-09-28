/**
 * Memo audience helpers — extracted into a pure module so they can be unit
 * tested without spinning up the HTTP layer. The shape mirrors the JSONB
 * column on `staff_memos.audienceFilter`.
 */

export type MemoAudienceFilter = {
  roles?: string[]
  staffIds?: string[]
}

/**
 * Normalise client input. Drops non-string / empty entries and dedupes each
 * array. Returns `{}` when nothing was selected so downstream callers can
 * treat empty filter == broadcast.
 */
export function sanitizeAudienceFilter(input: unknown): MemoAudienceFilter {
  if (!input || typeof input !== 'object') return {}
  const f = input as MemoAudienceFilter
  const out: MemoAudienceFilter = {}
  if (Array.isArray(f.roles)) {
    const v = f.roles.filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (v.length > 0) out.roles = Array.from(new Set(v))
  }
  if (Array.isArray(f.staffIds)) {
    const v = f.staffIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (v.length > 0) out.staffIds = Array.from(new Set(v))
  }
  return out
}

export function isBroadcast(filter: MemoAudienceFilter): boolean {
  return !filter.roles?.length && !filter.staffIds?.length
}

export function summarizeAudience(filter: MemoAudienceFilter): string {
  const parts: string[] = []
  if (filter.roles?.length) parts.push(filter.roles.join(', '))
  if (filter.staffIds?.length) parts.push(`${filter.staffIds.length} specific staff`)
  return parts.length === 0 ? 'All Staff' : parts.join(' · ')
}

/**
 * Returns true iff the given staff context falls into the memo's audience.
 *
 * Empty filter = broadcast to everyone. Otherwise filters compose
 * ADDITIVELY (OR across categories): a staff matches if they're in the
 * explicit staffIds list, OR their roleId is in the roles list.
 */
export function memoTargetsStaff(
  filter: unknown,
  ctx: { staffId: string; roleId: string | null }
): boolean {
  const f = (filter ?? {}) as MemoAudienceFilter
  if (isBroadcast(f)) return true
  if (f.staffIds?.includes(ctx.staffId)) return true
  if (ctx.roleId && f.roles?.includes(ctx.roleId)) return true
  return false
}
