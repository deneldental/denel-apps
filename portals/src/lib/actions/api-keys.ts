import { api } from '@/lib/api-client'

export type ApiKeyScope = 'website_bookings.create'

export type ApiKeyRow = {
  id: string
  label: string
  keyPrefix: string
  scope: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export type ApiKeyGenerated = {
  id: string
  label: string
  keyPrefix: string
  scope: string
  /** The plaintext key. Shown exactly once on creation. */
  plaintext: string
}

export type ApiKeyTestResult = {
  active: boolean
  scope: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export async function listApiKeys() {
  return api.get<ApiKeyRow[]>('/api/api-keys')
}

export async function createApiKey(label: string, scope: ApiKeyScope) {
  return api.post<ApiKeyGenerated>('/api/api-keys', { label, scope })
}

export async function revokeApiKey(id: string) {
  return api.post<{ alreadyRevoked?: boolean }>(`/api/api-keys/${id}/revoke`, {})
}

export async function testApiKey(id: string) {
  return api.post<ApiKeyTestResult>(`/api/api-keys/${id}/test`, {})
}

export async function verifyApiKeyPlaintext(key: string, scope: ApiKeyScope) {
  return api.post<{ valid: boolean; scope?: string; reason?: 'revoked' | 'unknown' }>(
    '/api/api-keys/verify',
    { key, scope }
  )
}
