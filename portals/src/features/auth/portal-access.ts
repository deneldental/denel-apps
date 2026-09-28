import { api } from '@/lib/api-client'

/** Shown when a signed-in account has no portal scope (sign-in page and dashboard guard). */
export const NO_PORTAL_ACCESS_MESSAGE =
  "This account doesn't have access to the clinic portal. Ask an administrator to give it a portal role."

/**
 * Can the signed-in account use the portal? Asks the backend for its portal
 * interface scope — the role's, or a per-person exception set in HR → Access.
 * 'unknown' means the check itself failed, which callers treat as "not yet".
 */
export async function checkPortalAccess(): Promise<'granted' | 'denied' | 'unknown'> {
  try {
    const res = await api.get<{ hasAccess: boolean }>('/api/auth/scope-access?scope=portal')
    if (!res.success || typeof res.data?.hasAccess !== 'boolean') return 'unknown'
    return res.data.hasAccess ? 'granted' : 'denied'
  } catch {
    return 'unknown'
  }
}
