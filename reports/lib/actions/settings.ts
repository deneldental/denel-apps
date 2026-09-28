import { api } from '@/lib/api-client'

// The products/inventory lock helpers that used to live here called
// `/api/settings/products/lock` and `/api/settings/inventory/lock`, endpoints
// the backend does not have (it serves `/api/settings/locks`), and nothing in
// this read-only app used them (settings-domain-audit D6).

/**
 * Get the low stock alert threshold
 */
export async function getLowStockAlertNumber() {
  return api.get<number>('/api/settings/low-stock-threshold')
}

/**
 * Set the low stock alert threshold (admin only)
 */
export async function setLowStockAlertNumber(threshold: number) {
  return api.post<any>('/api/settings/low-stock-threshold', { threshold })
}
