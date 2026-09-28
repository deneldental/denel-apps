import { api } from '@/lib/api-client'

/**
 * Get audit logs (admin only)
 */
export async function getAuditLogs(limit = 100) {
  return api.get<any[]>(`/api/audit-logs?limit=${limit}`)
}
