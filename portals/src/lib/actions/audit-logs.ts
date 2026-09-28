import { api } from '@/lib/api-client'

/**
 * Get audit logs (admin only).
 *
 * @param limit    Max rows to return (backend caps at 200).
 * @param entityId Optional server-side filter — return only logs for a single
 *                 entity. Drives the §19.2 audit drill-down deep links.
 */
export async function getAuditLogs(limit = 100, entityId?: string) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (entityId) params.set('entityId', entityId)
  return api.get<any[]>(`/api/audit-logs?${params.toString()}`)
}
