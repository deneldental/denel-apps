// Integration config helpers — typed getters that read from the clinicSettings
// KV table. Encrypted at rest with AES-256-GCM (key derived from
// BETTER_AUTH_SECRET — see lib/crypto.ts). Reads are backwards-compatible with
// legacy plaintext rows so a backfill can happen out-of-band; the
// `scripts/encrypt-integration-secrets.ts` script migrates existing rows.

import { eq } from 'drizzle-orm'
import { env } from '../config/env'
import { getDb } from '../db'
import { clinicSettings } from '../db/schema'
import { decryptJson, encryptJson, isEncryptedBlob } from './crypto'

// ── KV keys (kept here so they're not stringly-typed across the codebase) ────
export const INTEGRATION_KEYS = {
  R2: 'integration_r2',
  DO_SPACES: 'integration_do_spaces',
  CLOUDINARY: 'integration_cloudinary',
  HUBTEL: 'integration_hubtel',
  BACKUP: 'integration_backup',
  STORAGE_ROUTING: 'integration_storage_routing',
  UPSTASH: 'integration_upstash',
  CRON_ENGINE: 'integration_cron_engine',
  ANVIZ: 'integration_anviz',
} as const

// ── Config types ────────────────────────────────────────────────────────────

export type R2Config = {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  publicUrl: string
  /** Bucket for private files — no public access; same endpoint and API token. */
  privateBucket?: string
  /** Plan storage limit in GB; admin enters this since R2 doesn't expose a usage API on the S3 endpoint. */
  quotaGB?: number | null
}

export type DoSpacesConfig = {
  region: string
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  publicUrl: string
  /** Plan storage limit in GB; admin enters this since DO Spaces doesn't expose a usage API on the S3 endpoint. */
  quotaGB?: number | null
}

export type CloudinaryConfig = {
  cloudName: string
  apiKey: string
  apiSecret: string
  uploadFolder: string
  enabled: boolean
}

export type HubtelConfig = {
  clientId: string
  clientSecret: string
  senderId: string
}

export type BackupSchedule = 'daily-6pm' | 'weekly-sunday-6pm'

export type BackupConfig = {
  connectionString: string
  schedule: BackupSchedule
  targetProvider: 'r2' | 'do_spaces'
  enabled: boolean
  lastRunAt?: string | null
  lastStatus?: string | null
}

export type StorageProviderId = 'r2' | 'do_spaces' | 'cloudinary'

export type StorageRouting = {
  patient_records: StorageProviderId
  staff: StorageProviderId
  system_docs: StorageProviderId
  misc: StorageProviderId
}

/**
 * Upstash credentials. QStash schedules cron HTTP callbacks. Redis is used for
 * distributed locks so a job only runs in one backend instance at a time.
 * Both are optional — leave blank to disable that side.
 */
export type UpstashConfig = {
  /** QStash REST token. Read at https://console.upstash.com/qstash. */
  qstashToken: string
  /** Current signing key for verifying incoming QStash webhooks. */
  qstashCurrentSigningKey: string
  /** Next signing key — checked as a fallback during key rotation. */
  qstashNextSigningKey: string
  /**
   * QStash REST API base URL. Defaults to https://qstash.upstash.io/v2 when
   * empty. Override to http://127.0.0.1:8080/v2 (or similar) when pointing
   * at a local `qstash-cli dev` server.
   */
  qstashBaseUrl?: string
  /** Public base URL QStash should hit. Example: https://api.deneldental.com */
  publicBaseUrl: string
  /** Upstash Redis REST URL — used by the distributed lock layer. */
  redisRestUrl: string
  /** Upstash Redis REST token. */
  redisRestToken: string
}

/**
 * Cron engine selection. Both can be on at once: node-cron runs in-process
 * (no external dependency, useful in dev or single-node prod) while QStash
 * runs externally (durable, observable). When both are on the Redis lock
 * prevents double-firing.
 */
export type CronEngineConfig = {
  /** When true, the in-process node-cron scheduler registers all jobs. */
  nodeCronEnabled: boolean
  /**
   * When true, QStash schedules are created/updated to match the registry on
   * boot and on config save. Disable if Upstash isn't configured yet.
   */
  qstashEnabled: boolean
  /**
   * Optional override: only run these job ids. Leave empty to run everything
   * in the registry. Useful for staging where you may want a subset.
   */
  enabledJobIds?: string[]
  /**
   * Shared secret required on /api/internal/cron/* calls that are NOT
   * QStash-signed (manual triggers, local node-cron). Auto-generated on
   * first save if blank.
   */
  internalSecret: string
}

export type AnvizConfig = {
  webhookPassword?: string
  apiKey?: string
  apiSecret?: string
  apiRegion?: 'us' | 'ap' | 'eu'
}

// ── Generic KV access ───────────────────────────────────────────────────────

async function readKv<T>(key: string): Promise<T | null> {
  const db = getDb(env.DATABASE_URL)
  const [row] = await db.select().from(clinicSettings).where(eq(clinicSettings.key, key)).limit(1)
  if (!row) return null
  const raw = row.value as unknown
  // Encrypted envelope: decrypt and JSON.parse. Decryption failure (tampered
  // ciphertext or rotated BETTER_AUTH_SECRET) returns null rather than throwing,
  // so callers treat it the same as "not configured" and the admin can re-enter.
  if (isEncryptedBlob(raw)) {
    return decryptJson<T>(raw)
  }
  // Legacy plaintext row from before encryption shipped. Returned as-is so
  // existing installs keep working until the backfill script runs.
  return (raw as T | undefined) ?? null
}

/**
 * `updatedById` references a real user; pass null for writes no user made
 * (a scheduled job recording its outcome).
 */
async function writeKv<T>(key: string, value: T, updatedById: string | null): Promise<void> {
  const db = getDb(env.DATABASE_URL)
  const blob = encryptJson(value)
  await db
    .insert(clinicSettings)
    .values({ key, value: blob, updatedById })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value: blob, updatedById, updatedAt: new Date() },
    })
}

// ── Typed getters ───────────────────────────────────────────────────────────

export const getR2Config = () => readKv<R2Config>(INTEGRATION_KEYS.R2)
export const getDoSpacesConfig = () => readKv<DoSpacesConfig>(INTEGRATION_KEYS.DO_SPACES)
export const getCloudinaryConfig = () => readKv<CloudinaryConfig>(INTEGRATION_KEYS.CLOUDINARY)
export const getHubtelConfig = () => readKv<HubtelConfig>(INTEGRATION_KEYS.HUBTEL)
export const getBackupConfig = () => readKv<BackupConfig>(INTEGRATION_KEYS.BACKUP)
export const getStorageRouting = () => readKv<StorageRouting>(INTEGRATION_KEYS.STORAGE_ROUTING)
export const getUpstashConfig = () => readKv<UpstashConfig>(INTEGRATION_KEYS.UPSTASH)
export const getCronEngineConfig = () => readKv<CronEngineConfig>(INTEGRATION_KEYS.CRON_ENGINE)
export const getAnvizConfig = () => readKv<AnvizConfig>(INTEGRATION_KEYS.ANVIZ)

// ── Typed setters ───────────────────────────────────────────────────────────

export const setR2Config = (v: R2Config, by: string) => writeKv(INTEGRATION_KEYS.R2, v, by)
export const setDoSpacesConfig = (v: DoSpacesConfig, by: string) =>
  writeKv(INTEGRATION_KEYS.DO_SPACES, v, by)
export const setCloudinaryConfig = (v: CloudinaryConfig, by: string) =>
  writeKv(INTEGRATION_KEYS.CLOUDINARY, v, by)
export const setHubtelConfig = (v: HubtelConfig, by: string) =>
  writeKv(INTEGRATION_KEYS.HUBTEL, v, by)
/** `by` is null when the scheduled backup records its own outcome. */
export const setBackupConfig = (v: BackupConfig, by: string | null) =>
  writeKv(INTEGRATION_KEYS.BACKUP, v, by)
export const setStorageRouting = (v: StorageRouting, by: string) =>
  writeKv(INTEGRATION_KEYS.STORAGE_ROUTING, v, by)
export const setUpstashConfig = (v: UpstashConfig, by: string) =>
  writeKv(INTEGRATION_KEYS.UPSTASH, v, by)
export const setCronEngineConfig = (v: CronEngineConfig, by: string) =>
  writeKv(INTEGRATION_KEYS.CRON_ENGINE, v, by)
export const setAnvizConfig = (v: AnvizConfig, by: string) => writeKv(INTEGRATION_KEYS.ANVIZ, v, by)

// ── Redaction helpers ───────────────────────────────────────────────────────

/** Sentinel the frontend sends back unchanged to mean "keep existing secret". */
export const SECRET_SENTINEL = '••••••••'

/** Last-4-char preview, e.g. "wxyz" — for showing the user which key is set. */
export function maskTail(secret: string | undefined | null): string | null {
  if (!secret) return null
  if (secret.length <= 4) return '••••'
  return `••••${secret.slice(-4)}`
}

/**
 * Merge incoming write payload with existing config: any field whose incoming
 * value matches the SECRET_SENTINEL (or is missing) is left at its existing
 * value. This is what lets the frontend "save" without re-entering secrets.
 */
export function mergeSecrets<T extends Record<string, unknown>>(
  incoming: Partial<T>,
  existing: T | null,
  secretFields: Array<keyof T>
): T {
  const result = { ...(existing ?? {}), ...incoming } as T
  for (const field of secretFields) {
    const incomingVal = incoming[field]
    if (incomingVal === undefined || incomingVal === SECRET_SENTINEL) {
      // Preserve existing value (or empty string if neither exists)
      result[field] = (existing?.[field] ?? ('' as T[keyof T])) as T[typeof field]
    }
  }
  return result
}
