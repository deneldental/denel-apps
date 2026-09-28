import { api } from '@/lib/api-client'

export async function getUsers() {
  return api.get<any[]>('/api/users')
}

export async function getUserRole(userId: string) {
  // We can just fetch the user or add a specific role endpoint
  // For now, let's assume we might need a specific one or just use the user object
  // But to keep it similar to original:
  const res = await api.get<any[]>(`/api/users`)
  if (res.success) {
    const user = res.data?.find((u: any) => u.id === userId)
    return { success: true, data: user?.roleId || null }
  }
  return res
}

export async function updateUserRole(targetUserId: string, newRoleId: string) {
  const res = await api.patch<any>(`/api/users/${targetUserId}`, { roleId: newRoleId })
  return res
}

export async function updateUser(targetUserId: string, data: any) {
  const res = await api.patch<any>(`/api/users/${targetUserId}`, data)
  return res
}

export async function deleteUser(targetUserId: string) {
  const res = await api.delete<any>(`/api/users/${targetUserId}`)
  return res
}

export async function getRoles() {
  return api.get<any[]>('/api/users/roles')
}

export async function createUser(data: any) {
  const res = await api.post<any>('/api/users', data)
  return res
}
