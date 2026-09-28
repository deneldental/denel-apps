import { api } from '@/lib/api-client'

/**
 * Populate the database with 10 test patients, appointments, medical records, and payments.
 * Admin only — enforced by the backend.
 */
export async function populateTestData() {
  const res = await api.post<any>('/api/seed/populate', {})
  return res
}

/**
 * Clear all transactional data (payments, plans, medical records, appointments, patients).
 * Preserves users, roles, and lookup tables.
 * Admin only — enforced by the backend.
 */
export async function clearAllData() {
  const res = await api.delete<any>('/api/seed/clear')
  return res
}
