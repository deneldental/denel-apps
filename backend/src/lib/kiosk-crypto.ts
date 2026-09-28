/**
 * Kiosk crypto — admin-v1 CC.3.
 *
 * Device tokens + pairing codes are HIGH-entropy random secrets, so SHA-256 is
 * fine (fast hash, same rationale as api-keys.ts). PINs are LOW entropy, so they
 * use scrypt (slow) + per-operator rate-limit/lockout (kiosk_operators fields).
 */

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env'

const PAIRING_CODE_BYTES = 8 // ~13 base32 chars — readable + hard to guess
const DEVICE_TOKEN_BYTES = 32
const SCRYPT_KEYLEN = 32
const SALT_BYTES = 16

// Crockford-style base32 (no I/L/O/U) — easy to read + type on a station.
const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'
function base32(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function sha256(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex')
}

/** Constant-time compare of two hex strings. */
export function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** One-time pairing code: plaintext shown to the admin once; only the hash is stored. */
export function generatePairingCode(): { code: string; hash: string } {
  const code = base32(randomBytes(PAIRING_CODE_BYTES))
  return { code, hash: sha256(code) }
}

/** Long-lived device token: plaintext returned to the device once (httpOnly); hash stored. */
export function generateDeviceToken(): { token: string; hash: string } {
  const token = randomBytes(DEVICE_TOKEN_BYTES).toString('base64url')
  return { token, hash: sha256(token) }
}

/** scrypt PIN hash, stored as "salt:hash" (both hex). */
export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_BYTES)
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// ── Scoped session token ────────────────────────────────────────────────────
// Stateless HMAC-signed token (payload.signature). Each scoped-session request
// is ALSO re-checked against the live device + operator rows, so revoking a
// device or disabling an operator kills active sessions before expiry.

export interface KioskSessionClaims {
  deviceId: string
  operatorId: string
  surface: string
  epoch: number // operator sessionEpoch at issue time; mismatch => session invalidated
  exp: number // expiry, epoch ms
}

// Domain-separation tag so this signer can never collide with other HMAC uses
// of BETTER_AUTH_SECRET (e.g. OAuth-state, QStash).
const SESSION_CONTEXT = 'framada/kiosk-session/v1|'
function sessionHmac(payloadB64: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(SESSION_CONTEXT + payloadB64)
    .digest('base64url')
}

export function signSession(claims: KioskSessionClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sessionHmac(payload)}`
}

export function verifySession(token: string): KioskSessionClaims | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!hashesEqual(sig, sessionHmac(payload))) return null
  try {
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as KioskSessionClaims
    if (typeof claims.exp !== 'number' || claims.exp < Date.now()) return null
    return claims
  } catch {
    return null
  }
}
