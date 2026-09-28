// DB-backed Google OAuth credentials with env-var fallback. Lets clinic
// admins manage the credentials from the Integrations page instead of having
// to redeploy a Doppler change. The client secret is encrypted at rest using
// AES-256-GCM with a key derived from BETTER_AUTH_SECRET.
//
// Lookup precedence: clinic_settings row → env vars → null.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { env } from '../config/env'
import type { getDb } from '../db'
import { clinicSettings } from '../db/schema'

export const OAUTH_CONFIG_KEY = 'integrations:google_oauth_config'

export type GoogleOAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

type Db = ReturnType<typeof getDb>

type StoredConfig = {
  clientId: string
  redirectUri: string
  /** AES-256-GCM ciphertext of the client secret. */
  secret: { iv: string; ct: string; tag: string } | null
}

/** 32-byte key derived deterministically from BETTER_AUTH_SECRET. */
function getEncryptionKey(): Buffer {
  return createHash('sha256').update(env.BETTER_AUTH_SECRET, 'utf8').digest()
}

function encryptSecret(plaintext: string): { iv: string; ct: string; tag: string } {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return { iv: iv.toString('hex'), ct: ct.toString('hex'), tag: tag.toString('hex') }
}

function decryptSecret(blob: { iv: string; ct: string; tag: string }): string | null {
  try {
    const key = getEncryptionKey()
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'))
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'))
    const pt = Buffer.concat([decipher.update(Buffer.from(blob.ct, 'hex')), decipher.final()])
    return pt.toString('utf8')
  } catch {
    // Tampered ciphertext or BETTER_AUTH_SECRET rotated — fall back to env.
    return null
  }
}

async function readStored(db: Db): Promise<StoredConfig | null> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, OAUTH_CONFIG_KEY))
    .limit(1)
  if (!row) return null
  const v = row.value as Partial<StoredConfig> | null
  if (!v || typeof v.clientId !== 'string' || typeof v.redirectUri !== 'string') return null
  return {
    clientId: v.clientId,
    redirectUri: v.redirectUri,
    secret: v.secret ?? null,
  }
}

/**
 * Read what an admin would see for the OAuth config — the public bits in
 * plaintext, but never the client secret itself.
 */
export async function getOAuthConfigStatus(db: Db): Promise<{
  source: 'db' | 'env' | 'none'
  clientId: string | null
  redirectUri: string | null
  hasClientSecret: boolean
}> {
  const stored = await readStored(db)
  if (stored) {
    return {
      source: 'db',
      clientId: stored.clientId,
      redirectUri: stored.redirectUri,
      hasClientSecret: stored.secret !== null,
    }
  }
  const envClientId = env.GOOGLE_OAUTH_CLIENT_ID ?? null
  const envClientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET ?? null
  const envRedirectUri = env.GOOGLE_OAUTH_REDIRECT_URI ?? null
  if (envClientId && envClientSecret && envRedirectUri) {
    return {
      source: 'env',
      clientId: envClientId,
      redirectUri: envRedirectUri,
      hasClientSecret: true,
    }
  }
  return { source: 'none', clientId: null, redirectUri: null, hasClientSecret: false }
}

/**
 * Resolve a *complete* OAuth config (clientId + secret + redirectUri).
 * Returns null when the integration isn't fully configured from any source.
 * Used by the OAuth flow itself.
 */
export async function resolveOAuthConfig(db: Db): Promise<GoogleOAuthConfig | null> {
  const stored = await readStored(db)
  if (stored?.secret) {
    const decrypted = decryptSecret(stored.secret)
    if (decrypted) {
      return {
        clientId: stored.clientId,
        clientSecret: decrypted,
        redirectUri: stored.redirectUri,
      }
    }
    // Fall through to env if decryption fails (e.g. BETTER_AUTH_SECRET rotated)
  }
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

/**
 * Persist or update the DB-backed config. If `clientSecret` is null/undefined,
 * the existing encrypted secret is preserved (the admin can update clientId or
 * redirectUri without re-pasting the secret every time).
 */
export async function saveOAuthConfig(
  db: Db,
  input: { clientId: string; clientSecret: string | null; redirectUri: string },
  updatedById: string
): Promise<void> {
  const existing = await readStored(db)
  const secretBlob =
    input.clientSecret && input.clientSecret.length > 0
      ? encryptSecret(input.clientSecret)
      : (existing?.secret ?? null)

  const value: StoredConfig = {
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    secret: secretBlob,
  }

  await db
    .insert(clinicSettings)
    .values({ key: OAUTH_CONFIG_KEY, value, updatedById })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value, updatedById, updatedAt: new Date() },
    })
}

export async function clearOAuthConfig(db: Db): Promise<void> {
  await db.delete(clinicSettings).where(eq(clinicSettings.key, OAUTH_CONFIG_KEY))
}
