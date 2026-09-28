import { api } from '@/lib/api-client'

/**
 * Get products lock status
 */
export async function getProductsLockStatus() {
  const res = await api.get<any>('/api/settings/locks')
  if (res.success && res.data) {
    return {
      success: true,
      data: { isLocked: res.data.products?.isLocked, isAdmin: res.data.isAdmin },
    }
  }
  return res
}

/**
 * Set products lock status (admin only)
 */
export async function setProductsLockStatus(locked: boolean) {
  return api.post<any>('/api/settings/locks/products', { locked })
}

/**
 * Check if user can perform action on products (considering lock status)
 */
export async function canPerformProductAction(
  action: string
): Promise<{ allowed: boolean; reason?: string }> {
  // This is now handled by the backend. We can either call a dedicated check endpoint
  // or just attempt the action and handle the error.
  // For frontend UI logic, we check the lock status.
  const res = await getProductsLockStatus()
  if (!res.success) return { allowed: false, reason: res.error }

  const { isLocked, isAdmin } = res.data
  if (isLocked && !isAdmin && ['create', 'update', 'delete'].includes(action)) {
    return { allowed: false, reason: 'Products are locked. Only administrators can make changes.' }
  }
  return { allowed: true }
}

/**
 * Get inventory lock status
 */
export async function getInventoryLockStatus() {
  const res = await api.get<any>('/api/settings/locks')
  if (res.success && res.data) {
    return {
      success: true,
      data: { isLocked: res.data.inventory?.isLocked, isAdmin: res.data.isAdmin },
    }
  }
  return res
}

/**
 * Set inventory lock status (admin only)
 */
export async function setInventoryLockStatus(locked: boolean) {
  return api.post<any>('/api/settings/locks/inventory', { locked })
}

/**
 * Check if user can perform action on inventory (considering lock status)
 */
export async function canPerformInventoryAction(
  action: string
): Promise<{ allowed: boolean; reason?: string }> {
  const res = await getInventoryLockStatus()
  if (!res.success) return { allowed: false, reason: res.error }

  const { isLocked, isAdmin } = res.data
  if (isLocked && !isAdmin && ['create', 'update', 'delete'].includes(action)) {
    return { allowed: false, reason: 'Inventory is locked. Only administrators can make changes.' }
  }
  return { allowed: true }
}

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

export type AppointmentAlertConfig = {
  enabled?: boolean
  durationMinutes: number
  soundDataUrl: string | null
  soundName: string | null
}

export async function getAppointmentAlertConfig() {
  return api.get<AppointmentAlertConfig>('/api/settings/appointment-alert-config')
}

export async function setAppointmentAlertConfig(config: AppointmentAlertConfig) {
  return api.post<AppointmentAlertConfig>('/api/settings/appointment-alert-config', config)
}
