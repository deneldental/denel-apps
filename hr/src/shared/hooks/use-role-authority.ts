import { ACTIONS, MODULES } from '@/lib/modules'
import { usePermissions } from './use-permissions'

/**
 * May this person assign ANY assignable role (an administrator), or only the everyday ones
 * (an HR administrator)? Mirrors the backend's `roleAuthority` in access-management.ts: full
 * authority is `access_management:update`, which administrators hold by default. Used to decide
 * which roles the screens OFFER; the server is what enforces it.
 */
export function useCanAssignAnyRole(): boolean {
  const { isAdmin, hasPermission } = usePermissions()
  return isAdmin || hasPermission(MODULES.ACCESS_MANAGEMENT, ACTIONS.UPDATE)
}
