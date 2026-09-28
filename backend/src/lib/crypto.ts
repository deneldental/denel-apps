// Symmetric secret encryption for DB-stored credentials.
//
// Uses AES-256-GCM with a 32-byte key derived from BETTER_AUTH_SECRET (single
// trust anchor — same approach as google-oauth-config and google-service-account
// which predate this file). Output shape:
//
//   { v: 1, iv: <hex>, ct: <hex>, tag: <hex> }
//
// `v` is reserved for future algorithm rotation; the only currently-accepted
// value is 1 (AES-256-GCM). Decryption returns null on tag failure (tampered
// ciphertext or rotated key) so callers can fall back gracefully.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env'

export type EncryptedBlob = {
  v: 1
  iv: string
  ct: string
  tag: string
}

function getEncryptionKey(): Buffer {
  return createHash('sha256').update(env.BETTER_AUTH_SECRET, 'utf8').digest()
}

export function encryptSecret(plaintext: string): EncryptedBlob {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: 1,
    iv: iv.toString('hex'),
    ct: ct.toString('hex'),
    tag: tag.toString('hex'),
  }
}

export function decryptSecret(blob: EncryptedBlob): string | null {
  try {
    const key = getEncryptionKey()
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'))
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'))
    const pt = Buffer.concat([decipher.update(Buffer.from(blob.ct, 'hex')), decipher.final()])
    return pt.toString('utf8')
  } catch {
    return null
  }
}

/** True when `value` has the AES-GCM envelope shape produced by encryptSecret. */
export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.v === 1 && typeof v.iv === 'string' && typeof v.ct === 'string' && typeof v.tag === 'string'
  )
}

/**
 * Encrypt an arbitrary JSON-serializable object as a single opaque blob.
 * Convenience wrapper for KV layers that store whole config objects.
 */
export function encryptJson<T>(value: T): EncryptedBlob {
  return encryptSecret(JSON.stringify(value))
}

/**
 * Decrypt a blob produced by encryptJson. Returns null if decryption fails
 * (tag mismatch, rotated key, malformed payload).
 */
export function decryptJson<T>(blob: EncryptedBlob): T | null {
  const pt = decryptSecret(blob)
  if (pt === null) return null
  try {
    return JSON.parse(pt) as T
  } catch {
    return null
  }
}
