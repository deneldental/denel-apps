import { api } from '@/lib/api-client'

// Sentinel the server interprets as "leave existing secret untouched".
export const SECRET_SENTINEL = '••••••••'

// ── Cloudflare R2 ───────────────────────────────────────────────────────────

export type R2Status = {
  endpoint: string
  bucket: string
  region: string
  publicUrl: string
  privateBucket: string
  quotaGB: number | null
  hasAccessKey: boolean
  hasSecretKey: boolean
  accessKeyMasked: string | null
  secretKeyMasked: string | null
}

export type R2WritePayload = {
  endpoint: string
  bucket: string
  region: string
  publicUrl: string
  /** Omitted = keep the saved value (the server merges). */
  privateBucket?: string
  quotaGB: number | null
  accessKeyId: string // SECRET_SENTINEL = preserve
  secretAccessKey: string // SECRET_SENTINEL = preserve
}

export const getR2Status = () => api.get<R2Status>('/api/integrations/r2')
export const saveR2 = (payload: R2WritePayload) => api.put('/api/integrations/r2', payload)
export type StorageBucketCheck = {
  role: 'public' | 'private'
  bucket: string
  ok: boolean
  error?: string
}
export type StorageTestResult = { ok: boolean; error?: string; buckets?: StorageBucketCheck[] }

export const testR2 = () => api.post<StorageTestResult>('/api/integrations/r2/test', {})

// ── DigitalOcean Spaces ─────────────────────────────────────────────────────

export type DoSpacesStatus = {
  region: string
  endpoint: string
  bucket: string
  publicUrl: string
  quotaGB: number | null
  hasAccessKey: boolean
  hasSecretKey: boolean
  accessKeyMasked: string | null
  secretKeyMasked: string | null
}

export type DoSpacesWritePayload = {
  region: string
  endpoint: string
  bucket: string
  publicUrl: string
  quotaGB: number | null
  accessKeyId: string
  secretAccessKey: string
}

export const getDoSpacesStatus = () => api.get<DoSpacesStatus>('/api/integrations/do-spaces')
export const saveDoSpaces = (payload: DoSpacesWritePayload) =>
  api.put('/api/integrations/do-spaces', payload)
export const testDoSpaces = () =>
  api.post<StorageTestResult>('/api/integrations/do-spaces/test', {})

// ── Provider usage ──────────────────────────────────────────────────────────

export type ProviderUsage = {
  usedBytes: number
  quotaBytes: number | null
  objectCount: number
  partial: boolean
  note?: string
}

export const getProviderUsage = (providerId: 'r2' | 'do_spaces' | 'cloudinary') =>
  api.get<ProviderUsage>(`/api/integrations/${providerId}/usage`)

// ── Cloudinary ──────────────────────────────────────────────────────────────

export type CloudinaryStatus = {
  cloudName: string
  uploadFolder: string
  enabled: boolean
  hasApiKey: boolean
  hasApiSecret: boolean
  apiKeyMasked: string | null
  apiSecretMasked: string | null
}

export type CloudinaryWritePayload = {
  cloudName: string
  uploadFolder: string
  enabled: boolean
  apiKey: string // SECRET_SENTINEL = preserve
  apiSecret: string // SECRET_SENTINEL = preserve
}

export const getCloudinaryStatus = () => api.get<CloudinaryStatus>('/api/integrations/cloudinary')
export const saveCloudinary = (payload: CloudinaryWritePayload) =>
  api.put('/api/integrations/cloudinary', payload)
export const testCloudinary = () =>
  api.post<{ ok: boolean; error?: string }>('/api/integrations/cloudinary/test', {})

// ── Hubtel SMS ──────────────────────────────────────────────────────────────

export type HubtelStatus = {
  senderId: string
  hasClientId: boolean
  hasClientSecret: boolean
  clientIdMasked: string | null
  clientSecretMasked: string | null
}

export type HubtelWritePayload = {
  senderId: string
  clientId: string
  clientSecret: string
}

/** What happened to the one real test SMS the Hubtel test sends. */
export type HubtelTestResult = {
  ok: boolean
  /** Hubtel accepted the message. */
  sent?: boolean
  /** Local development without SMS_REDIRECT_PHONE: printed, not sent. */
  simulated?: boolean
  reason?: string
  error?: string
}

export const getHubtelStatus = () => api.get<HubtelStatus>('/api/integrations/hubtel')
export const saveHubtel = (payload: HubtelWritePayload) =>
  api.put('/api/integrations/hubtel', payload)
export const testHubtel = (phone: string) =>
  api.post<HubtelTestResult>('/api/integrations/hubtel/test', { phone })

// ── Database backup ─────────────────────────────────────────────────────────

export type BackupSchedule = 'daily-6pm' | 'weekly-sunday-6pm'

export type BackupStatus = {
  schedule: BackupSchedule
  targetProvider: 'r2' | 'do_spaces'
  enabled: boolean
  lastRunAt: string | null
  lastStatus: string | null
  hasConnectionString: boolean
  connectionStringMasked: string | null
}

export type BackupWritePayload = {
  connectionString: string
  schedule: BackupSchedule
  targetProvider: 'r2' | 'do_spaces'
  enabled: boolean
}

export const getBackupStatus = () => api.get<BackupStatus>('/api/integrations/backup')
export const saveBackup = (payload: BackupWritePayload) =>
  api.put('/api/integrations/backup', payload)

// ── Storage routing ─────────────────────────────────────────────────────────

export type StorageProviderId = 'r2' | 'do_spaces' | 'cloudinary'

export type StorageRoutingResponse = {
  routing: {
    patient_records: StorageProviderId
    staff: StorageProviderId
    system_docs: StorageProviderId
    misc: StorageProviderId
  }
  providers: Array<{ id: StorageProviderId; label: string; configured: boolean }>
}

export const getStorageRouting = () =>
  api.get<StorageRoutingResponse>('/api/integrations/storage-routing')
export const saveStorageRouting = (routing: StorageRoutingResponse['routing']) =>
  api.put('/api/integrations/storage-routing', routing)

// ── Upstash (QStash + Redis) ─────────────────────────────────────────────────

export type UpstashStatus = {
  publicBaseUrl: string
  qstashBaseUrl: string
  redisRestUrl: string
  hasQstashToken: boolean
  hasQstashCurrentSigningKey: boolean
  hasQstashNextSigningKey: boolean
  hasRedisRestToken: boolean
  qstashTokenMasked: string | null
  qstashCurrentSigningKeyMasked: string | null
  qstashNextSigningKeyMasked: string | null
  redisRestTokenMasked: string | null
}

export type UpstashWritePayload = {
  qstashToken?: string
  qstashCurrentSigningKey?: string
  qstashNextSigningKey?: string
  qstashBaseUrl?: string
  publicBaseUrl?: string
  redisRestUrl?: string
  redisRestToken?: string
}

export type UpstashTestResult = {
  qstash: { ok: boolean; error?: string }
  redis: { ok: boolean; error?: string }
}

export const getUpstashStatus = () => api.get<UpstashStatus>('/api/integrations/upstash')
export const saveUpstash = (payload: UpstashWritePayload) =>
  api.put<{ reloadWarning?: string }>('/api/integrations/upstash', payload)
export const testUpstash = () => api.post<UpstashTestResult>('/api/integrations/upstash/test', {})

// ── Cron engine ──────────────────────────────────────────────────────────────

export type CronEngineStatus = {
  config: {
    nodeCronEnabled: boolean
    qstashEnabled: boolean
    enabledJobIds: string[]
    hasInternalSecret: boolean
    internalSecretMasked: string | null
    bootError: string | null
  }
  jobs: Array<{
    id: string
    description: string
    cron: string
    timeoutMs: number
    nextRuns: string[]
    lastRun: {
      status: string
      source: string
      startedAt: string
      finishedAt: string | null
      summary: string | null
      errorMessage: string | null
    } | null
  }>
  qstash: {
    configured: boolean
    schedules: Array<{
      scheduleId: string
      destination: string
      cron: string
      createdAt: string
      matchedJobId: string | null
      nextScheduleTime: string | null
      isPaused: boolean
    }>
    /** Recent QStash events for our backend's destinations. */
    events: Array<{
      messageId: string
      url: string
      /** CREATED | ACTIVE | DELIVERED | FAILED | RETRY | … */
      state: string
      time: string
      scheduleId: string | null
      nextDeliveryTime: string | null
      error: string | null
    }>
    error: string | null
  }
}

export type CronEngineWritePayload = {
  nodeCronEnabled?: boolean
  qstashEnabled?: boolean
  enabledJobIds?: string[]
}

export const getCronEngineStatus = () => api.get<CronEngineStatus>('/api/integrations/cron-engine')
export const saveCronEngine = (payload: CronEngineWritePayload) =>
  api.put('/api/integrations/cron-engine', payload)
// Waits for the job to finish — a database backup takes minutes, well past the
// client's default 30-second timeout (the backend's own call to the job gives
// up after 5 minutes too).
export const runCronJobNow = (jobId: string) =>
  api.post<{ status: string; summary?: string; error?: string }>(
    `/api/integrations/cron-engine/run/${encodeURIComponent(jobId)}`,
    {},
    { timeout: 5 * 60 * 1000 }
  )

// ── Anviz Attendance ────────────────────────────────────────────────────────

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
