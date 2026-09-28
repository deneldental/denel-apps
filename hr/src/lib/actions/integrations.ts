import { api } from '@/lib/api-client'

/** Masked value the backend returns/accepts to preserve an existing secret. */
export const SECRET_SENTINEL = '••••••••'

export type AnvizStatus = {
  webhookUrl: string
  hasWebhookPassword: boolean
  hasApiKey: boolean
  hasApiSecret: boolean
  webhookPasswordMasked: string | null
  apiKeyMasked: string | null
  apiSecretMasked: string | null
  apiRegion?: 'us' | 'ap' | 'eu'
}

export type AnvizWritePayload = {
  webhookPassword?: string // SECRET_SENTINEL = preserve
  apiKey?: string // SECRET_SENTINEL = preserve
  apiSecret?: string // SECRET_SENTINEL = preserve
  apiRegion?: 'us' | 'ap' | 'eu'
}

export const getAnvizStatus = () => api.get<AnvizStatus>('/api/integrations/anviz')
export const getAnvizSecret = () =>
  api.get<{ webhookPassword: string }>('/api/integrations/anviz/secret')
export const saveAnviz = (payload: AnvizWritePayload) => api.put('/api/integrations/anviz', payload)
export const testAnvizWebhook = (payload: { webhookPassword?: string }) =>
  api.post<{ ok: boolean; error?: string }>('/api/integrations/anviz/test-webhook', payload)
export const testAnvizApi = (payload: {
  apiKey?: string
  apiSecret?: string
  apiRegion?: string
}) => api.post<{ ok: boolean; error?: string }>('/api/integrations/anviz/test-api', payload)

export const startAnvizApiPolling = () =>
  api.post<{ success: boolean; message?: string }>('/api/integrations/anviz/start-polling', {})
