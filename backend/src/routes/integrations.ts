// Integrations API — admin-only configurators for R2, DO Spaces, Hubtel,
// database backup, and per-category storage routing. Secrets stored plaintext
// in clinic_settings KV (encryption is a planned follow-up — localized to
// lib/integrations.ts when added). Every GET handler omits secret fields and
// returns hasFoo + masked previews so cleartext never leaves the server.

import { randomBytes } from 'node:crypto'
import { ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { env as envCfg, isDevEnvironment } from '../config/env'
import { getDb } from '../db'
import { attendanceEvents, cronJobRuns, staff } from '../db/schema'
import { type BrandingConfig, getBranding, setBranding } from '../lib/branding'
import { getCronBootError, reloadCronEngine } from '../lib/cron'
import { buildPipelineSnapshot } from '../lib/cron/pipeline'
import { normalizeQstashBase } from '../lib/cron/qstash-url'
import { CRON_JOBS } from '../lib/cron/registry'
import {
  type AnvizConfig,
  type BackupConfig,
  type CloudinaryConfig,
  type CronEngineConfig,
  type DoSpacesConfig,
  getAnvizConfig,
  getBackupConfig,
  getCloudinaryConfig,
  getCronEngineConfig,
  getDoSpacesConfig,
  getHubtelConfig,
  getR2Config,
  getStorageRouting,
  getUpstashConfig,
  type HubtelConfig,
  maskTail,
  mergeSecrets,
  type R2Config,
  SECRET_SENTINEL,
  type StorageRouting,
  setAnvizConfig,
  setBackupConfig,
  setCloudinaryConfig,
  setCronEngineConfig,
  setDoSpacesConfig,
  setHubtelConfig,
  setR2Config,
  setStorageRouting,
  setUpstashConfig,
  type UpstashConfig,
} from '../lib/integrations'
import { logger } from '../lib/logger'
import { getHubtelCredentials, sendSMS } from '../lib/sms'
import {
  buildS3CompatRuntime,
  getPrivateTarget,
  getProvider,
  getProviderUsage,
  listProviders,
  sameBucket,
} from '../lib/storage-providers'
import { uploadToCategory } from '../lib/storage-router'
import type { HonoEnv } from '../lib/types'
import { uploadProfiles, validateUpload } from '../lib/upload-validation'
import { checkPermission } from '../rbac/middleware/checkPermission'
import { verifySession } from '../rbac/middleware/verifySession'

const integrationsApp = new Hono<HonoEnv>()

const MODULE = 'settings'
const READ = 'read'
const UPDATE = 'update'

/**
 * Connectivity check for every bucket a provider uses (R2: public + private;
 * DO Spaces: its one bucket), through the same code path real uploads use
 * (registry + endpoint normalization). Reports each bucket separately.
 */
async function testS3Compat(providerId: 'r2' | 'do_spaces', c: any) {
  const adapter = getProvider(providerId)
  if (adapter.kind !== 's3-compat') {
    return c.json({ success: true, data: { ok: false, error: 'Not an S3-compatible provider' } })
  }
  // A list call, not HeadBucket: Cloudflare's least-privilege "Object Read &
  // Write" token covers listing objects but not bucket-level operations.
  const checks: Array<{ role: 'public' | 'private'; bucket: string; client: S3Client }> = []
  try {
    const runtime = await buildS3CompatRuntime(adapter)
    checks.push({ role: 'public', bucket: runtime.bucket, client: runtime.client })
    if (!adapter.supportsObjectAcl) {
      const target = await getPrivateTarget(providerId)
      checks.push({ role: 'private', bucket: target.bucket, client: target.client })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ success: true, data: { ok: false, error: message, buckets: [] } })
  }

  const buckets: Array<{
    role: 'public' | 'private'
    bucket: string
    ok: boolean
    error?: string
  }> = []
  for (const check of checks) {
    try {
      await check.client.send(new ListObjectsV2Command({ Bucket: check.bucket, MaxKeys: 1 }))
      buckets.push({ role: check.role, bucket: check.bucket, ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      buckets.push({ role: check.role, bucket: check.bucket, ok: false, error: message })
    }
  }
  const failed = buckets.find((b) => !b.ok)
  return c.json({
    success: true,
    data: failed
      ? { ok: false, error: `${failed.bucket}: ${failed.error}`, buckets }
      : { ok: true, buckets },
  })
}

// ── Cloudflare R2 ────────────────────────────────────────────────────────────

integrationsApp.get('/r2', verifySession(), checkPermission(MODULE, READ), async (c) => {
  const cfg = await getR2Config()
  return c.json({
    success: true,
    data: {
      endpoint: cfg?.endpoint ?? '',
      bucket: cfg?.bucket ?? '',
      region: cfg?.region ?? 'auto',
      publicUrl: cfg?.publicUrl ?? '',
      privateBucket: cfg?.privateBucket ?? '',
      quotaGB: cfg?.quotaGB ?? null,
      hasAccessKey: !!cfg?.accessKeyId,
      hasSecretKey: !!cfg?.secretAccessKey,
      accessKeyMasked: maskTail(cfg?.accessKeyId),
      secretKeyMasked: maskTail(cfg?.secretAccessKey),
    },
  })
})

integrationsApp.put('/r2', verifySession(), checkPermission(MODULE, UPDATE), async (c) => {
  const user = c.var.user
  const body = (await c.req.json()) as Partial<R2Config>
  const existing = await getR2Config()
  const merged = mergeSecrets<R2Config>(body, existing, ['accessKeyId', 'secretAccessKey'])
  if (sameBucket(merged.privateBucket, merged.bucket)) {
    return c.json(
      {
        error:
          'The private bucket must be a different bucket from the public one — otherwise every private file would be public.',
      },
      400
    )
  }
  await setR2Config(merged, user.id)
  return c.json({ success: true })
})

integrationsApp.post('/r2/test', verifySession(), checkPermission(MODULE, READ), async (c) => {
  return testS3Compat('r2', c)
})

// ── DigitalOcean Spaces ──────────────────────────────────────────────────────

integrationsApp.get('/do-spaces', verifySession(), checkPermission(MODULE, READ), async (c) => {
  const cfg = await getDoSpacesConfig()
  return c.json({
    success: true,
    data: {
      region: cfg?.region ?? '',
      endpoint: cfg?.endpoint ?? '',
      bucket: cfg?.bucket ?? '',
      publicUrl: cfg?.publicUrl ?? '',
      quotaGB: cfg?.quotaGB ?? null,
      hasAccessKey: !!cfg?.accessKeyId,
      hasSecretKey: !!cfg?.secretAccessKey,
      accessKeyMasked: maskTail(cfg?.accessKeyId),
      secretKeyMasked: maskTail(cfg?.secretAccessKey),
    },
  })
})

integrationsApp.put('/do-spaces', verifySession(), checkPermission(MODULE, UPDATE), async (c) => {
  const user = c.var.user
  const body = (await c.req.json()) as Partial<DoSpacesConfig>
  const existing = await getDoSpacesConfig()
  const merged = mergeSecrets<DoSpacesConfig>(body, existing, ['accessKeyId', 'secretAccessKey'])
  await setDoSpacesConfig(merged, user.id)
  return c.json({ success: true })
})

integrationsApp.post(
  '/do-spaces/test',
  verifySession(),
  checkPermission(MODULE, READ),
  async (c) => {
    return testS3Compat('do_spaces', c)
  }
)

// ── Cloudinary ───────────────────────────────────────────────────────────────
// Config CRUD for the Cloudinary storage provider. The upload adapter, usage
// probe, and storage-routing wiring already exist (storage-providers.ts); these
// three routes complete the admin surface so the Integrations page can read and
// save the credentials instead of 404ing.

integrationsApp.get('/cloudinary', verifySession(), checkPermission(MODULE, READ), async (c) => {
  const cfg = await getCloudinaryConfig()
  return c.json({
    success: true,
    data: {
      cloudName: cfg?.cloudName ?? '',
      uploadFolder: cfg?.uploadFolder ?? '',
      enabled: cfg?.enabled ?? false,
      hasApiKey: !!cfg?.apiKey,
      hasApiSecret: !!cfg?.apiSecret,
      apiKeyMasked: maskTail(cfg?.apiKey),
      apiSecretMasked: maskTail(cfg?.apiSecret),
    },
  })
})

integrationsApp.put('/cloudinary', verifySession(), checkPermission(MODULE, UPDATE), async (c) => {
  const user = c.var.user
  const body = (await c.req.json()) as Partial<CloudinaryConfig>
  const existing = await getCloudinaryConfig()
  // apiKey/apiSecret arrive as SECRET_SENTINEL when the admin left them
  // untouched — mergeSecrets preserves the stored value in that case.
  const merged = mergeSecrets<CloudinaryConfig>(body, existing, ['apiKey', 'apiSecret'])
  if (typeof merged.enabled !== 'boolean') merged.enabled = false
  await setCloudinaryConfig(merged, user.id)
  return c.json({ success: true })
})

integrationsApp.post(
  '/cloudinary/test',
  verifySession(),
  checkPermission(MODULE, READ),
  async (c) => {
    const cfg = await getCloudinaryConfig()
    if (!cfg?.cloudName || !cfg.apiKey || !cfg.apiSecret) {
      return c.json({ success: true, data: { ok: false, error: 'Configuration incomplete' } })
    }
    // Reuse the usage probe as a connectivity/credential check — cloudinary.api
    // .usage() authenticates against the account and throws on bad credentials,
    // consuming no storage.
    try {
      await getProviderUsage('cloudinary')
      return c.json({ success: true, data: { ok: true } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ success: true, data: { ok: false, error: message } })
    }
  }
)

// ── Hubtel SMS ──────────────────────────────────────────────────────────────

integrationsApp.get('/hubtel', verifySession(), checkPermission(MODULE, READ), async (c) => {
  const cfg = await getHubtelConfig()
  return c.json({
    success: true,
    data: {
      senderId: cfg?.senderId ?? '',
      hasClientId: !!cfg?.clientId,
      hasClientSecret: !!cfg?.clientSecret,
      clientIdMasked: maskTail(cfg?.clientId),
      clientSecretMasked: maskTail(cfg?.clientSecret),
    },
  })
})

integrationsApp.put('/hubtel', verifySession(), checkPermission(MODULE, UPDATE), async (c) => {
  const user = c.var.user
  const body = (await c.req.json()) as Partial<HubtelConfig>
  const existing = await getHubtelConfig()
  const merged = mergeSecrets<HubtelConfig>(body, existing, ['clientId', 'clientSecret'])
  await setHubtelConfig(merged, user.id)
  return c.json({ success: true })
})

/** Hubtel explains a rejection in `statusDescription`; surface it when present. */
function hubtelFailureMessage(error: string | undefined, details: string | undefined): string {
  try {
    const reason = JSON.parse(details ?? '')?.statusDescription
    if (typeof reason === 'string' && reason) return `Hubtel rejected the message: ${reason}`
  } catch {
    // Not a Hubtel JSON body — fall through to the plain error.
  }
  return error ?? 'SMS failed'
}

// Hubtel publishes no free credential check, so the test sends ONE real SMS to
// a number the admin enters — through the normal sending path, with the keys
// and Sender ID real messages use — proving keys, Sender ID and delivery
// together. It spends one SMS credit, hence settings:update.
integrationsApp.post(
  '/hubtel/test',
  verifySession(),
  checkPermission(MODULE, UPDATE),
  async (c) => {
    const user = c.var.user
    const body = (await c.req.json().catch(() => ({}))) as { phone?: unknown }
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    if (!phone) return c.json({ error: 'Enter the phone number to send the test SMS to' }, 400)

    if (!(await getHubtelCredentials())) {
      return c.json({
        success: true,
        data: { ok: false, error: 'No Hubtel Client ID and Client Secret are configured' },
      })
    }

    try {
      const branding = await getBranding()
      const result = await sendSMS(
        [
          {
            phone,
            message: `${branding.shortName || branding.name}: this is a test message. Your Hubtel SMS settings work.`,
          },
        ],
        undefined,
        'test',
        user.id
      )
      if (!result.success) {
        const details = 'details' in result ? result.details : undefined
        return c.json({
          success: true,
          data: { ok: false, error: hubtelFailureMessage(result.error, details) },
        })
      }
      const outcome = result.data as { simulated?: boolean; reason?: string } | undefined
      if (outcome?.simulated) {
        return c.json({
          success: true,
          data: { ok: true, sent: false, simulated: true, reason: outcome.reason },
        })
      }
      return c.json({ success: true, data: { ok: true, sent: true } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ success: true, data: { ok: false, error: message } })
    }
  }
)

// ── Database backup ──────────────────────────────────────────────────────────

integrationsApp.get('/backup', verifySession(), checkPermission(MODULE, READ), async (c) => {
  const cfg = await getBackupConfig()
  return c.json({
    success: true,
    data: {
      schedule: cfg?.schedule ?? 'daily-6pm',
      targetProvider: cfg?.targetProvider ?? 'r2',
      enabled: cfg?.enabled ?? false,
      lastRunAt: cfg?.lastRunAt ?? null,
      lastStatus: cfg?.lastStatus ?? null,
      hasConnectionString: !!cfg?.connectionString,
      connectionStringMasked: maskTail(cfg?.connectionString),
    },
  })
})

integrationsApp.put('/backup', verifySession(), checkPermission(MODULE, UPDATE), async (c) => {
  const user = c.var.user
  const body = (await c.req.json()) as Partial<BackupConfig>
  const existing = await getBackupConfig()
  const merged = mergeSecrets<BackupConfig>(body, existing, ['connectionString'])
  // Defaults for any fields neither side provided
  if (!merged.schedule) merged.schedule = 'daily-6pm'
  if (!merged.targetProvider) merged.targetProvider = 'r2'
  if (typeof merged.enabled !== 'boolean') merged.enabled = false
  await setBackupConfig(merged, user.id)
  // Re-register cron with the new schedule (no server restart needed).
  try {
    await reloadCronEngine()
  } catch (err) {
    logger.error({ err }, '[integrations] failed to restart backup scheduler')
  }
  return c.json({ success: true })
})

// ── Storage routing (per-file-category provider mapping) ─────────────────────

integrationsApp.get(
  '/storage-routing',
  verifySession(),
  checkPermission(MODULE, READ),
  async (c) => {
    const cfg = await getStorageRouting()
    // Drive the provider list from the registry so the UI dropdown reflects
    // every adapter we support — adding a new one means one entry in
    // `STORAGE_PROVIDERS`, not changes here.
    const adapters = listProviders()
    const providers: Array<{ id: string; label: string; configured: boolean }> = await Promise.all(
      adapters.map(async (a) => {
        const c = await a.loadConfig()
        let configured = false
        if (a.kind === 's3-compat') {
          const cc = c as { accessKeyId?: string } | null
          configured = !!cc?.accessKeyId
        } else {
          const cc = c as { apiKey?: string; enabled?: boolean } | null
          configured = !!cc?.apiKey && !!cc?.enabled
        }
        return { id: a.id, label: a.label, configured }
      })
    )
    // Backwards-compat: configs saved before `staff` was introduced will not
    // have that key. Default it to whatever `system_docs` resolves to since
    // that's effectively where staff files would have ended up before.
    const routing: StorageRouting = cfg
      ? {
          patient_records: cfg.patient_records,
          staff: cfg.staff ?? cfg.system_docs,
          system_docs: cfg.system_docs,
          misc: cfg.misc,
        }
      : { patient_records: 'r2', staff: 'r2', system_docs: 'r2', misc: 'r2' }
    return c.json({ success: true, data: { routing, providers } })
  }
)

// Usage probe — used by each config card's progress bar. Live (no caching)
// since admins visit this page rarely; for S3-compat providers it paginates
// ListObjectsV2 (capped at 10k objects) so it's bounded but may be `partial:true`
// for very large buckets.
integrationsApp.get(
  '/:provider/usage',
  verifySession(),
  checkPermission(MODULE, READ),
  async (c) => {
    const provider = c.req.param('provider')
    if (provider !== 'r2' && provider !== 'do_spaces' && provider !== 'cloudinary') {
      return c.json({ error: 'Unknown provider' }, 400)
    }
    try {
      const usage = await getProviderUsage(provider)
      return c.json({ success: true, data: usage })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read usage'
      return c.json({ success: false, error: message }, 500)
    }
  }
)

integrationsApp.put(
  '/storage-routing',
  verifySession(),
  checkPermission(MODULE, UPDATE),
  async (c) => {
    const user = c.var.user
    const body = (await c.req.json()) as Partial<StorageRouting>
    const existing = await getStorageRouting()
    const merged: StorageRouting = {
      patient_records: (body.patient_records ??
        existing?.patient_records ??
        'r2') as StorageRouting['patient_records'],
      staff: (body.staff ??
        existing?.staff ??
        existing?.system_docs ??
        'r2') as StorageRouting['staff'],
      system_docs: (body.system_docs ??
        existing?.system_docs ??
        'r2') as StorageRouting['system_docs'],
      misc: (body.misc ?? existing?.misc ?? 'r2') as StorageRouting['misc'],
    }
    await setStorageRouting(merged, user.id)
    return c.json({ success: true })
  }
)

// ── Branding (clinic name, logo, contact, SMS sender, email From, etc.) ──────

// Public endpoint — no session required; returns only safe/display fields for login pages.
integrationsApp.get('/branding/public', async (c) => {
  const cfg = await getBranding()
  return c.json({
    success: true,
    data: {
      name: cfg.name,
      logoIconUrl: cfg.logoIconUrl,
      logoHorizontalUrl: cfg.logoHorizontalUrl,
      logoUrl: cfg.logoUrl,
      portalLoginImageUrl: cfg.portalLoginImageUrl,
      portalLoginImageUrls: cfg.portalLoginImageUrls,
      portalLoginImagePosition: cfg.portalLoginImagePosition,
      pwaLoginImageUrl: cfg.pwaLoginImageUrl,
      pwaLoginImagePosition: cfg.pwaLoginImagePosition,
      themeColor: cfg.themeColor,
      accentColor: cfg.accentColor,
      // Public clinic contact details (shown e.g. in the patient app's
      // "Contact the clinic" dialog).
      phones: cfg.phones,
      email: cfg.email,
      address: cfg.address,
    },
  })
})

integrationsApp.get('/branding', verifySession(), async (c) => {
  const cfg = await getBranding()
  return c.json({ success: true, data: cfg })
})

integrationsApp.put('/branding', verifySession(), checkPermission(MODULE, UPDATE), async (c) => {
  const user = c.var.user
  const body = (await c.req.json()) as Partial<BrandingConfig>
  const existing = await getBranding()
  // Field-level merge: callers can PATCH any subset
  const merged: BrandingConfig = {
    ...existing,
    ...body,
    social: { ...existing.social, ...(body.social ?? {}) },
  }
  // Validate SMS sender ID — Hubtel limit
  if (merged.smsSenderId.length > 11) {
    return c.json({ error: 'smsSenderId must be 11 characters or fewer' }, 400)
  }
  // Copyright defaults to name when blank
  if (!merged.copyrightHolder?.trim()) merged.copyrightHolder = merged.name
  await setBranding(merged, user.id)
  return c.json({ success: true })
})

// Dev-mode: serve files saved locally when no cloud storage is configured.
integrationsApp.get('/dev-uploads/*', async (c) => {
  const isDev = isDevEnvironment()
  if (!isDev) return c.json({ error: 'Not found' }, 404)

  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const filePath = join(process.cwd(), 'dev-uploads', c.req.param('*') ?? '')

  try {
    const buf = await readFile(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    const MIME: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      gif: 'image/gif',
    }
    c.header('Content-Type', MIME[ext] ?? 'application/octet-stream')
    c.header('Cache-Control', 'no-cache')
    return c.body(buf)
  } catch {
    return c.json({ error: 'File not found' }, 404)
  }
})

// Multipart branding asset upload — logo, favicon, logo-icon, logo-horizontal, portal/pwa-login-image.
// Routes through `uploadToCategory` (cloud storage). In dev with no storage configured, falls back
// to writing the file locally and serving it via /api/integrations/dev-uploads/*.
integrationsApp.post(
  '/branding/logo',
  verifySession(),
  checkPermission(MODULE, UPDATE),
  async (c) => {
    const formData = await c.req.formData().catch(() => null)
    if (!formData) return c.json({ error: 'Invalid form data' }, 400)

    const file = formData.get('file') as File | null
    const kindRaw = (formData.get('kind') as string | null) ?? ''

    const LOGO_KINDS = ['logo', 'logo-icon', 'logo-horizontal'] as const
    const ALL_KINDS = [
      'logo',
      'favicon',
      'logo-icon',
      'logo-horizontal',
      'portal-login-image',
      'pwa-login-image',
    ] as const
    type UploadKind = (typeof ALL_KINDS)[number]
    const kind: UploadKind = (ALL_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as UploadKind)
      : 'logo'

    if (!file) return c.json({ error: 'Missing file' }, 400)

    const isLogoKind = (LOGO_KINDS as readonly string[]).includes(kind)
    const profile = isLogoKind ? uploadProfiles.logo : uploadProfiles.image

    const validation = await validateUpload(file, profile)
    if (!validation.ok) return c.json({ error: validation.error }, 400)

    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    // Single-slot assets (logo, favicon) key on the kind alone so a re-upload
    // replaces the old file. Login-panel photos are a list — several exist at
    // once — so they get a unique suffix; without it a second upload would
    // overwrite the first at the same path.
    const MULTI_KINDS = ['portal-login-image'] as const
    const suffix = (MULTI_KINDS as readonly string[]).includes(kind)
      ? `-${randomBytes(4).toString('hex')}`
      : ''
    const name = `${kind}${suffix}.${ext}`
    const key = `branding/${name}`

    try {
      const { url } = await uploadToCategory(
        'system_docs',
        `SYS/${key}`,
        Buffer.from(validation.buffer),
        file.type,
        'public'
      )
      return c.json({ success: true, data: { url, kind } })
    } catch (err) {
      const isDev = isDevEnvironment()
      const isUnconfigured = err instanceof Error && err.message.includes('not configured')

      if (isDev && isUnconfigured) {
        const { writeFile, mkdir } = await import('node:fs/promises')
        const { join } = await import('node:path')
        const localDir = join(process.cwd(), 'dev-uploads', 'branding')
        await mkdir(localDir, { recursive: true })
        await writeFile(join(localDir, name), Buffer.from(validation.buffer))
        const base = process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
        const url = `${base}/api/integrations/dev-uploads/branding/${name}`
        return c.json({ success: true, data: { url, kind } })
      }

      const message = err instanceof Error ? err.message : 'Unknown error'
      logger.error({ err }, '[integrations] branding upload failed')
      return c.json({ error: message }, 500)
    }
  }
)

// ── Upstash (QStash + Redis) ─────────────────────────────────────────────────

integrationsApp.get('/upstash', verifySession(), checkPermission(MODULE, READ), async (c) => {
  const cfg = await getUpstashConfig()
  return c.json({
    success: true,
    data: {
      publicBaseUrl: cfg?.publicBaseUrl ?? '',
      qstashBaseUrl: cfg?.qstashBaseUrl ?? '',
      redisRestUrl: cfg?.redisRestUrl ?? '',
      hasQstashToken: !!cfg?.qstashToken,
      hasQstashCurrentSigningKey: !!cfg?.qstashCurrentSigningKey,
      hasQstashNextSigningKey: !!cfg?.qstashNextSigningKey,
      hasRedisRestToken: !!cfg?.redisRestToken,
      qstashTokenMasked: maskTail(cfg?.qstashToken),
      qstashCurrentSigningKeyMasked: maskTail(cfg?.qstashCurrentSigningKey),
      qstashNextSigningKeyMasked: maskTail(cfg?.qstashNextSigningKey),
      redisRestTokenMasked: maskTail(cfg?.redisRestToken),
    },
  })
})

integrationsApp.put('/upstash', verifySession(), checkPermission(MODULE, UPDATE), async (c) => {
  const user = c.var.user
  const body = (await c.req.json()) as Partial<UpstashConfig>
  const existing = await getUpstashConfig()
  const merged = mergeSecrets<UpstashConfig>(body, existing, [
    'qstashToken',
    'qstashCurrentSigningKey',
    'qstashNextSigningKey',
    'redisRestToken',
  ])
  await setUpstashConfig(merged, user.id)
  // Reload engines so QStash either picks up the new credentials or shuts
  // down the schedule sync if creds were cleared.
  let reloadWarning: string | undefined
  try {
    await reloadCronEngine()
  } catch (err) {
    logger.warn({ err }, '[integrations] reloadCronEngine failed after upstash save')
    reloadWarning = err instanceof Error ? err.message : 'Cron engine reload failed'
  }
  return c.json({ success: true, data: { reloadWarning } })
})

integrationsApp.post('/upstash/test', verifySession(), checkPermission(MODULE, READ), async (c) => {
  const cfg = await getUpstashConfig()
  if (!cfg) {
    return c.json({
      success: true,
      data: {
        qstash: { ok: false, error: 'Not configured' },
        redis: { ok: false, error: 'Not configured' },
      },
    })
  }

  const qstashBase = normalizeQstashBase(cfg.qstashBaseUrl)

  const [qstash, redis] = await Promise.all([
    cfg.qstashToken
      ? fetch(`${qstashBase}/schedules`, {
          headers: { Authorization: `Bearer ${cfg.qstashToken}` },
        })
          .then((res) => (res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` }))
          .catch((err) => ({
            ok: false,
            error: err instanceof Error ? err.message : 'Network error',
          }))
      : Promise.resolve({ ok: false, error: 'Token not configured' }),

    cfg.redisRestUrl && cfg.redisRestToken
      ? fetch(`${cfg.redisRestUrl}/ping`, {
          headers: { Authorization: `Bearer ${cfg.redisRestToken}` },
        })
          .then((res) => (res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` }))
          .catch((err) => ({
            ok: false,
            error: err instanceof Error ? err.message : 'Network error',
          }))
      : Promise.resolve({ ok: false, error: 'Not configured' }),
  ])

  return c.json({ success: true, data: { qstash, redis } })
})

// ── Cron engine (registry + node-cron/QStash toggles + recent runs) ───────────

integrationsApp.get('/cron-engine', verifySession(), checkPermission(MODULE, READ), async (c) => {
  const cfg = await getCronEngineConfig()
  const db = getDb(envCfg.DATABASE_URL)
  // Latest run per job, joined into a map.
  const recent = await db.select().from(cronJobRuns).orderBy(desc(cronJobRuns.startedAt)).limit(200)
  const latestByJob = new Map<string, (typeof recent)[number]>()
  for (const r of recent) {
    if (!latestByJob.has(r.jobId)) latestByJob.set(r.jobId, r)
  }

  // Pipeline snapshot: next-runs per job (always) + QStash live state when
  // configured. Failures here are non-fatal — the config + history still
  // render so the admin can act.
  const pipeline = await buildPipelineSnapshot().catch((err) => {
    logger.warn({ err: (err as Error).message }, '[cron-engine] pipeline snapshot failed')
    return null
  })

  return c.json({
    success: true,
    data: {
      config: {
        nodeCronEnabled: cfg?.nodeCronEnabled ?? false,
        qstashEnabled: cfg?.qstashEnabled ?? false,
        enabledJobIds: cfg?.enabledJobIds ?? [],
        hasInternalSecret: !!cfg?.internalSecret,
        internalSecretMasked: maskTail(cfg?.internalSecret),
        bootError: getCronBootError(),
      },
      jobs: CRON_JOBS.map((j) => {
        const last = latestByJob.get(j.id)
        const next = pipeline?.nextRuns.find((p) => p.jobId === j.id)
        return {
          id: j.id,
          description: j.description,
          cron: j.cron,
          timeoutMs: j.timeoutMs,
          nextRuns: next?.nextRuns ?? [],
          lastRun: last
            ? {
                status: last.status,
                source: last.source,
                startedAt: last.startedAt,
                finishedAt: last.finishedAt,
                summary: last.summary,
                errorMessage: last.errorMessage,
              }
            : null,
        }
      }),
      qstash: pipeline?.qstash ?? {
        configured: false,
        schedules: [],
        pending: [],
        error: null,
      },
    },
  })
})

integrationsApp.put('/cron-engine', verifySession(), checkPermission(MODULE, UPDATE), async (c) => {
  const user = c.var.user
  const body = (await c.req.json()) as Partial<CronEngineConfig>
  const existing = await getCronEngineConfig()
  const merged: CronEngineConfig = {
    nodeCronEnabled: body.nodeCronEnabled ?? existing?.nodeCronEnabled ?? true,
    qstashEnabled: body.qstashEnabled ?? existing?.qstashEnabled ?? false,
    enabledJobIds: body.enabledJobIds ?? existing?.enabledJobIds ?? [],
    internalSecret:
      body.internalSecret ?? existing?.internalSecret ?? randomBytes(32).toString('hex'),
  }
  await setCronEngineConfig(merged, user.id)
  try {
    await reloadCronEngine()
  } catch (err) {
    logger.warn({ err }, '[integrations] reloadCronEngine failed after cron-engine save')
  }
  return c.json({ success: true })
})

// Manual fire — admin clicks "Run now" on a job from the UI. Routes through
// the same internal cron endpoint so audit/lock/timeout behave identically.
integrationsApp.post(
  '/cron-engine/run/:jobId',
  verifySession(),
  checkPermission(MODULE, UPDATE),
  async (c) => {
    const jobId = c.req.param('jobId')
    const cfg = await getCronEngineConfig()
    if (!cfg?.internalSecret) {
      return c.json({ success: false, error: 'cron engine not configured' }, 400)
    }
    const port = process.env.PORT ?? '3000'
    const target = `http://127.0.0.1:${port}/api/internal/cron/${encodeURIComponent(jobId)}`
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'X-Cron-Secret': cfg.internalSecret, 'Content-Type': 'application/json' },
      body: '{}',
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return c.json({ success: res.ok, status: res.status, ...json })
  }
)

// ── Anviz Attendance ────────────────────────────────────────────────────────

integrationsApp.get('/anviz', verifySession(), checkPermission(MODULE, READ), async (c) => {
  const cfg = await getAnvizConfig()
  const origin = new URL(c.req.url).origin
  return c.json({
    success: true,
    data: {
      webhookUrl: `${origin}/api/staff/attendance/webhook`,
      hasWebhookPassword: !!cfg?.webhookPassword,
      hasApiKey: !!cfg?.apiKey,
      hasApiSecret: !!cfg?.apiSecret,
      webhookPasswordMasked: maskTail(cfg?.webhookPassword),
      apiKeyMasked: maskTail(cfg?.apiKey),
      apiSecretMasked: maskTail(cfg?.apiSecret),
      apiRegion: cfg?.apiRegion || 'us',
    },
  })
})

// Returns the plaintext webhook password so the HR portal can display the
// full `?password=` URL for copying into the Anviz device dashboard. Headers
// remain the preferred auth mechanism; the query parameter is a fallback for
// devices that cannot set custom headers.
integrationsApp.get('/anviz/secret', verifySession(), checkPermission(MODULE, READ), async (c) => {
  const cfg = await getAnvizConfig()
  return c.json({
    success: true,
    data: {
      webhookPassword: cfg?.webhookPassword || '',
    },
  })
})

integrationsApp.put('/anviz', verifySession(), checkPermission(MODULE, UPDATE), async (c) => {
  const user = c.var.user
  const body = (await c.req.json()) as Partial<AnvizConfig>
  const existing = await getAnvizConfig()
  const merged = mergeSecrets<AnvizConfig>(body, existing, [
    'webhookPassword',
    'apiKey',
    'apiSecret',
  ])
  merged.apiRegion = body.apiRegion ?? existing?.apiRegion ?? 'us'
  await setAnvizConfig(merged, user.id)
  return c.json({ success: true })
})

integrationsApp.post(
  '/anviz/test-webhook',
  verifySession(),
  checkPermission(MODULE, READ),
  async (c) => {
    const body = (await c.req.json()) as { webhookPassword?: string }
    let password = body.webhookPassword
    if (!password || password === SECRET_SENTINEL) {
      const cfg = await getAnvizConfig()
      password = cfg?.webhookPassword
    }

    if (!password) {
      return c.json({ success: true, data: { ok: false, error: 'Webhook password is not set' } })
    }

    try {
      const origin = new URL(c.req.url).origin
      // Make a real POST call internally to test the webhook and verify password validation
      const res = await fetch(`${origin}/api/staff/attendance/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Anviz-Password': password,
          'X-Expected-Webhook-Password': password,
          'X-Internal-Secret': process.env.BETTER_AUTH_SECRET || '',
        },
        body: JSON.stringify({
          records: [
            {
              uuid: 'test-webhook-uuid',
              check_time: new Date().toISOString(),
              check_type: '0',
              employee: {
                workno: 'test-workno',
                first_name: 'Test',
                last_name: 'User',
              },
              device: {
                serial_number: 'test-device-serial',
                name: 'Test Device',
              },
            },
          ],
        }),
      })

      if (res.ok) {
        return c.json({ success: true, data: { ok: true } })
      } else {
        const errText = await res.text().catch(() => '')
        return c.json({
          success: true,
          data: { ok: false, error: `Webhook responded with HTTP ${res.status}: ${errText}` },
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ success: true, data: { ok: false, error: message } })
    }
  }
)

function getAnvizApiBaseUrl(region?: string): string {
  if (region === 'ap') return 'https://api.ap.crosschexcloud.com/'
  if (region === 'eu') return 'https://api.eu.crosschexcloud.com/'
  return 'https://api.us.crosschexcloud.com/' // Default to 'us'
}

integrationsApp.post(
  '/anviz/test-api',
  verifySession(),
  checkPermission(MODULE, READ),
  async (c) => {
    const body = (await c.req.json()) as { apiKey?: string; apiSecret?: string; apiRegion?: string }
    let apiKey = body.apiKey
    let apiSecret = body.apiSecret
    let apiRegion = body.apiRegion

    if (!apiKey || apiKey === SECRET_SENTINEL || !apiSecret || apiSecret === SECRET_SENTINEL) {
      const cfg = await getAnvizConfig()
      if (!apiKey || apiKey === SECRET_SENTINEL) apiKey = cfg?.apiKey
      if (!apiSecret || apiSecret === SECRET_SENTINEL) apiSecret = cfg?.apiSecret
      if (!apiRegion) apiRegion = cfg?.apiRegion
    }

    if (!apiRegion) {
      apiRegion = 'us'
    }

    if (!apiKey || !apiSecret) {
      return c.json({ success: true, data: { ok: false, error: 'API credentials incomplete' } })
    }

    const apiBaseUrl = getAnvizApiBaseUrl(apiRegion)

    try {
      const payload = {
        header: {
          version: '1.0',
          nameSpace: 'authorize.token',
          nameAction: 'token',
          requestId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        },
        payload: {
          api_key: apiKey,
          api_secret: apiSecret,
        },
      }

      const res = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        return c.json({
          success: true,
          data: { ok: false, error: `Anviz API returned HTTP ${res.status}` },
        })
      }

      const data = (await res.json()) as {
        header?: { code?: number; message?: string }
        payload?: { token?: string }
      }

      // Check if Anviz returned success code (usually code: 0 or token present)
      if (data?.payload?.token) {
        return c.json({ success: true, data: { ok: true } })
      } else {
        const errorMsg = data?.header?.message || 'Failed to retrieve auth token from Anviz'
        return c.json({ success: true, data: { ok: false, error: errorMsg } })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ success: true, data: { ok: false, error: message } })
    }
  }
)

// ── GET/POST Anviz API Background Polling Test ─────────────────────────────

let pollingInterval: NodeJS.Timeout | null = null
let pollingEndTime = 0

integrationsApp.post(
  '/anviz/start-polling',
  verifySession(),
  checkPermission(MODULE, READ),
  async (c) => {
    const _user = c.var.user
    const cfg = await getAnvizConfig()
    const apiKey = cfg?.apiKey
    const apiSecret = cfg?.apiSecret
    const apiRegion = cfg?.apiRegion || 'us'

    if (!apiKey || !apiSecret) {
      return c.json({ error: 'API Key and Secret must be configured and saved first' }, 400)
    }

    if (pollingInterval) {
      clearInterval(pollingInterval)
    }

    pollingEndTime = Date.now() + 120 * 1000 // 2 minutes
    const apiBaseUrl = getAnvizApiBaseUrl(apiRegion)

    const runPoll = async () => {
      if (Date.now() > pollingEndTime) {
        if (pollingInterval) {
          clearInterval(pollingInterval)
          pollingInterval = null
        }
        logger.info('[Anviz Poll] Polling test period ended.')
        return
      }

      logger.info(`[Anviz Poll] Running API check on region: ${apiRegion}...`)

      try {
        // 1. Get Token
        const tokenPayload = {
          header: {
            version: '1.0',
            nameSpace: 'authorize.token',
            nameAction: 'token',
            requestId: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
          },
          payload: {
            api_key: apiKey,
            api_secret: apiSecret,
          },
        }

        const tokenRes = await fetch(apiBaseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tokenPayload),
        })

        if (!tokenRes.ok) {
          logger.error(`[Anviz Poll] Token fetch failed with HTTP ${tokenRes.status}`)
          return
        }

        const tokenData = (await tokenRes.json()) as {
          payload?: { token?: string }
        }

        const token = tokenData?.payload?.token
        if (!token) {
          logger.error('[Anviz Poll] Token missing in response payload')
          return
        }

        // 2. Fetch Records (last 15 minutes)
        const now = new Date()
        const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000)

        const recordPayload = {
          header: {
            version: '1.0',
            nameSpace: 'attendance.record',
            nameAction: 'getrecord',
            requestId: crypto.randomUUID(),
            timestamp: now.toISOString(),
          },
          payload: {
            token,
            begin_time: fifteenMinutesAgo.toISOString(),
            end_time: now.toISOString(),
            page: 1,
            per_page: 100,
          },
        }

        const recordRes = await fetch(apiBaseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(recordPayload),
        })

        if (!recordRes.ok) {
          logger.error(`[Anviz Poll] Record query failed with HTTP ${recordRes.status}`)
          return
        }

        const recordData = (await recordRes.json()) as {
          payload?: {
            list?: Array<{
              checktime: string
              employee?: {
                workno?: string
                first_name?: string
                last_name?: string
              }
              device?: {
                serial_number?: string
                name?: string
              }
            }>
          }
        }

        const records = recordData?.payload?.list ?? []
        if (records.length === 0) {
          logger.info('[Anviz Poll] No records fetched in last 15 minutes')
          return
        }

        const db = getDb(envCfg.DATABASE_URL)
        let insertedCount = 0

        for (const record of records) {
          const deviceUserId = record?.employee?.workno
          const checkTime = record?.checktime
          const serialNumber = record?.device?.serial_number
          const _deviceName = record?.device?.name

          if (!deviceUserId || !checkTime) continue

          // Resolve staffId
          const staffRow = await db.query.staff.findFirst({
            where: and(eq(staff.deviceUserId, deviceUserId), isNull(staff.deletedAt)),
            columns: { id: true },
          })

          const eventTimestamp = new Date(checkTime)

          const [inserted] = await db
            .insert(attendanceEvents)
            .values({
              staffId: staffRow?.id ?? null,
              deviceUserId,
              deviceUserName:
                record?.employee?.first_name || record?.employee?.last_name
                  ? `${record.employee.first_name || ''} ${record.employee.last_name || ''}`.trim()
                  : null,
              eventTimestamp,
              deviceNo: serialNumber ?? null,
              rawStatus: null,
              sourceFile: 'anviz_cloud_api',
            })
            .onConflictDoNothing({
              target: [
                attendanceEvents.deviceUserId,
                attendanceEvents.eventTimestamp,
                attendanceEvents.deviceNo,
                attendanceEvents.rawStatus,
              ],
            })
            .returning({ id: attendanceEvents.id })

          if (inserted) {
            insertedCount++
          }
        }

        logger.info(`[Anviz Poll] Success: Ingested ${insertedCount} new records from Cloud API`)
      } catch (err) {
        logger.error({ err }, '[Anviz Poll] Exception in polling background task')
      }
    }

    // Run first tick synchronously to catch configuration errors immediately
    await runPoll()

    // Continue running every 15 seconds in the background
    pollingInterval = setInterval(() => {
      void runPoll()
    }, 15 * 1000)

    return c.json({
      success: true,
      message:
        'Background polling started successfully! Device sync will poll every 15 seconds for 2 minutes.',
    })
  }
)

export { integrationsApp }
