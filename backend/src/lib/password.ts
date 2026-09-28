/**
 * Password hashing — argon2id via @node-rs/argon2 (native binding).
 *
 * Why argon2id?
 *   Memory-hard, resistant to GPU/ASIC brute-force attacks. Recommended by
 *   OWASP 2024 and the Password Hashing Competition. @node-rs/argon2 is a
 *   native Node.js binding — fast enough for production use (~10–30ms per
 *   hash on standard hardware).
 *
 * Parameters (OWASP 2024 minimum profile):
 *   m=19456 (19 MB memory), t=2 (time cost), p=1 (parallelism)
 *
 * Hash format (current):
 *   argon2id PHC string — self-describing, emitted by @node-rs/argon2:
 *   $argon2id$v=19$m=19456,t=2,p=1$<base64-salt>$<base64-hash>
 *
 * Legacy format (PBKDF2, still verified for backward compatibility):
 *   pbkdf2:<iterations>:<base64-salt>:<base64-hash>
 *   On successful PBKDF2 verify, callers should call needsRehash() and
 *   re-hash + store the new argon2id hash if it returns true.
 *
 * Obsolete format (better-auth default scrypt, pre-migration):
 *   <hex-salt>:<hex-hash>   (no prefix)
 *   Cannot be verified here. Affected users must reset via Forgot Password.
 */

import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'
import { logger } from './logger'

// OWASP 2024 minimum: m≥19456, t≥2, p≥1
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
}

// ─── PBKDF2 legacy path (read-only, never hashes new passwords) ──────────────

const PBKDF2_ALGORITHM = 'PBKDF2'
const PBKDF2_HASH = 'SHA-256'
const PBKDF2_KEY_BITS = 256

async function derivePbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    PBKDF2_ALGORITHM,
    false,
    ['deriveBits']
  )
  const buffer = await crypto.subtle.deriveBits(
    { name: PBKDF2_ALGORITHM, salt: salt as any, iterations, hash: PBKDF2_HASH },
    keyMaterial,
    PBKDF2_KEY_BITS
  )
  return new Uint8Array(buffer)
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function verifyPbkdf2(hash: string, password: string): Promise<boolean> {
  const parts = hash.split(':')
  if (parts.length !== 4) {
    logger.error('[auth] Malformed PBKDF2 hash — expected 4 colon-separated segments.')
    return false
  }
  const [, iterStr, saltB64, hashB64] = parts
  const iterations = parseInt(iterStr, 10)
  if (!Number.isFinite(iterations) || iterations < 1) {
    logger.error('[auth] Invalid PBKDF2 iteration count in stored hash.')
    return false
  }
  let salt: Uint8Array
  let storedHash: Uint8Array
  try {
    salt = fromBase64(saltB64)
    storedHash = fromBase64(hashB64)
  } catch {
    logger.error('[auth] Failed to decode PBKDF2 hash components.')
    return false
  }
  const computed = await derivePbkdf2(password, salt, iterations)
  return timingSafeEqual(computed, storedHash)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Hash a plain-text password with argon2id.
 * Returns an argon2id PHC string (self-describing, includes salt + params).
 * Compatible with the better-auth emailAndPassword.password.hash interface.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS)
}

/**
 * Returns true if the stored hash is not argon2id — i.e. it was hashed with
 * the old PBKDF2 algorithm and should be re-hashed on next successful login.
 */
export function needsRehash(hash: string): boolean {
  return !hash.startsWith('$argon2id$')
}

/**
 * Verify a plain-text password against a stored hash.
 *
 * Handles three formats:
 *   - argon2id PHC string (`$argon2id$...`): verify with @node-rs/argon2.
 *   - PBKDF2 (`pbkdf2:...`): verify with Web Crypto API (legacy path).
 *     Call needsRehash() on the caller side to trigger transparent re-hashing.
 *   - Legacy scrypt (no prefix): reject — user must reset via Forgot Password.
 *
 * Compatible with the better-auth emailAndPassword.password.verify interface.
 */
/** The shape better-auth calls this with. */
export interface VerifyPasswordArgs {
  hash: string
  password: string
}

/**
 * L8: this was `(args: any, ...extra: any[])`, accepting both an object and a
 * positional `(password, hash)` call "just in case". Two conventions on a
 * function that decides whether a password is correct is a hazard, not a
 * convenience: transpose the two strings at any call site and the comparison
 * still runs, just against the wrong operands. The positional branch had no
 * caller — better-auth passes the object form — so it is gone, and the argument
 * is typed.
 */
export async function verifyPassword(args: VerifyPasswordArgs): Promise<boolean> {
  const hashStr = args?.hash ?? ''
  const passwordStr = args?.password ?? ''

  if (!hashStr || typeof hashStr !== 'string') {
    logger.error('[auth] Invalid hash provided to verifyPassword')
    return false
  }

  if (hashStr.startsWith('$argon2id$')) {
    try {
      return await argon2Verify(hashStr, passwordStr)
    } catch {
      logger.error('[auth] argon2id verify failed unexpectedly.')
      return false
    }
  }

  if (hashStr.startsWith('pbkdf2:')) {
    return verifyPbkdf2(hashStr, passwordStr)
  }

  // Legacy @noble/hashes/scrypt hash from original better-auth default.
  // Cannot verify without re-running the slow pure-JS scrypt. User must
  // reset their password via the Forgot Password flow.
  logger.warn('[auth] Legacy scrypt hash detected. User must reset via Forgot Password.')
  return false
}
