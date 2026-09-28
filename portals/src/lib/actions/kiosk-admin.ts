import { api } from '@/lib/api-client'

// Admin kiosk management (admin-v1 CC.3 / §16.1). Portal-authed (Access Management).

export interface KioskDevice {
  id: string
  label: string
  location: string | null
  surface: string
  isActive: boolean
  isPaired: boolean
  pairingExpiresAt: string | null
  pairedAt: string | null
  lastSeenAt: string | null
  revokedAt: string | null
  createdAt: string
}
export interface KioskOperator {
  id: string
  staffId: string
  capabilities: Record<string, string[]>
  isActive: boolean
  lockedUntil: string | null
  updatedAt: string
}
type WithCode = KioskDevice & { pairingCode: string }

export interface KioskOperation {
  id: string
  action: string
  module: string
  entityName: string | null
  createdAt: string
  operatorName?: string | null
  operatorRole?: string | null
  patientName?: string | null
  changes?: Record<string, unknown> | null
  ipAddress?: string | null
}

export function getKioskDevices() {
  return api.get<KioskDevice[]>('/api/kiosk/devices')
}
export function createKioskDevice(body: {
  label: string
  location?: string | null
  surface: string
}) {
  return api.post<WithCode>('/api/kiosk/devices', body)
}
export function updateKioskDevice(
  id: string,
  body: { label?: string; location?: string | null; surface?: string }
) {
  return api.patch<KioskDevice>(`/api/kiosk/devices/${id}`, body)
}
export function getKioskDeviceOperations(id: string) {
  return api.get<KioskOperation[]>(`/api/kiosk/devices/${id}/operations`)
}
export function revokeKioskDevice(id: string) {
  return api.post<KioskDevice>(`/api/kiosk/devices/${id}/revoke`, {})
}
export function reissueKioskCode(id: string) {
  return api.post<WithCode>(`/api/kiosk/devices/${id}/pairing-code`, {})
}
export function deleteKioskDevice(id: string) {
  return api.delete<unknown>(`/api/kiosk/devices/${id}`)
}
export function getKioskOperators() {
  return api.get<KioskOperator[]>('/api/kiosk/operators')
}
export function setKioskOperator(
  staffId: string,
  body: { pin: string; capabilities: Record<string, string[]> }
) {
  return api.put<{ id: string; staffId: string }>(`/api/kiosk/operators/${staffId}`, body)
}
export function updateKioskOperator(
  staffId: string,
  body: { pin?: string; capabilities?: Record<string, string[]>; isActive?: boolean }
) {
  return api.put<{ id: string; staffId: string }>(`/api/kiosk/operators/${staffId}`, body)
}
export function deactivateKioskOperator(staffId: string) {
  return api.delete<unknown>(`/api/kiosk/operators/${staffId}`)
}
