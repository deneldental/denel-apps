import { api } from './api-client'
import { authClient } from './auth-client'

export async function checkPermission(
  _userId: string,
  module: string,
  action: string
): Promise<boolean> {
  // For static site, we should probably fetch this from the backend or
  // rely on the user object in the session if it has role/permissions.
  // Better yet, let's add a /api/auth/permissions endpoint to the backend.

  try {
    const res = await api.get<any>(`/api/auth/check-permission?module=${module}&action=${action}`)
    return res.success && res.data?.allowed
  } catch (error) {
    console.error('[RBAC] Error checking permission:', error)
    return false
  }
}

export async function getCurrentUser() {
  const session = await authClient.getSession()
  return session?.data?.user
}

export async function isDoctorOrAdmin(_userId: string): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false

  // Assuming user object from session has roleId or similar
  // In Better Auth, it's usually on the user object if configured
  const roleId = (user as any).roleId
  return roleId === 'admin' || roleId === 'doctor'
}
