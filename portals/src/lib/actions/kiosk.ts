import { api } from '@/lib/api-client'

// Device-facing kiosk API (admin-v1 CC.3). Authed by the httpOnly device-token +
// scoped-session cookies (sent automatically) + the api-client's CSRF double-submit.
// 401 here means "unpaired / locked", NOT portal-session expiry — so every call
// opts out of the global session-expired redirect.

const OPTS = { suppressSessionExpired: true } as const

export interface KioskOperatorLite {
  id: string
  name: string | null
  displayName: string
  title: 'Dr.' | 'DT.'
  operatorType: 'doctor' | 'dental_technician'
  specialty?: string | null
}

export interface KioskMe {
  device: { id: string; label: string; surface: string }
  operators: KioskOperatorLite[]
}

export interface KioskSession {
  surface: string
  capabilities: string[]
  expiresAt: number
  operator?: {
    id: string
    staffId: string
    displayName: string
    title: 'Dr.' | 'DT.'
    operatorType: 'doctor' | 'dental_technician'
    specialty?: string | null
  }
  user?: {
    id: string
    name: string
    displayName: string
    title: 'Dr.' | 'DT.'
    role: string
    operatorType: 'doctor' | 'dental_technician'
  }
}
export interface KioskPatient {
  id: string
  name: string
  phone: string | null
}
export interface KioskXrayType {
  id: string
  name: string
}

export function pairKiosk(code: string) {
  return api.post<{ surface: string; label: string }>('/api/kiosk/pair', { code }, OPTS)
}
export function getKioskMe() {
  return api.get<KioskMe>('/api/kiosk/me', OPTS)
}
export function openKioskSession(operatorId: string, pin: string) {
  return api.post<KioskSession>('/api/kiosk/session', { operatorId, pin }, OPTS)
}
export function lockKiosk() {
  return api.post<unknown>('/api/kiosk/lock', {}, OPTS)
}
export function searchKioskPatients(q: string) {
  return api.get<KioskPatient[]>(`/api/kiosk/xrays/patients?q=${encodeURIComponent(q)}`, OPTS)
}
export function getKioskXrayTypes() {
  return api.get<KioskXrayType[]>('/api/kiosk/xrays/types', OPTS)
}
// Upload the captured image to blob storage first; returns its URL. Keeps the
// /xrays POST body tiny (a URL, not a multi-MB base64 data URL).
export function uploadKioskXrayImage(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return api.post<{ url: string }>('/api/kiosk/xrays/upload', formData, OPTS)
}
export function captureKioskXray(payload: {
  patientId: string
  imageUrl: string
  xrayTypeId?: string | null
  notes?: string | null
}) {
  return api.post<{ id: string }>('/api/kiosk/xrays', payload, OPTS)
}

// ── Consents surface (§18.4) ──────────────────────────────────────────────────

export interface KioskConsentTemplate {
  id: string
  name: string
  description: string | null
}

export function getKioskConsentTemplates() {
  return api.get<KioskConsentTemplate[]>('/api/kiosk/consents/templates', OPTS)
}
export function searchKioskConsentPatients(q: string) {
  return api.get<KioskPatient[]>(`/api/kiosk/consents/patients?q=${encodeURIComponent(q)}`, OPTS)
}
export function signKioskConsent(payload: {
  templateId: string
  patientId: string
  patientName?: string
  signatureDataUrl: string
}) {
  return api.post<{ id: string }>('/api/kiosk/consents/sign', payload, OPTS)
}
