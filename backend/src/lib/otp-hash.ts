/**
 * Keyed hashing for one-time codes (audit finding L10).
 *
 * OTP codes were stored as a bare `SHA-256(code)`. For a six-digit code that is
 * not a hash in any meaningful sense: the entire input space is 10^6 values, so
 * anyone who can read the `staff_otp_codes` / `patient_otp_codes` table can
 * recover every live code by hashing a million candidates — well under a second
 * — and then complete a login or a password reset as that person. A read-only
 * database leak, a backup, or a replica snapshot was therefore enough.
 *
 * An HMAC keyed on a server-side secret removes that: the stored value cannot be
 * brute-forced without the key, which lives in the environment rather than the
 * database. The two have to be stolen separately.
 *
 * Domain-separated per purpose so a digest captured from one table can never be
 * replayed against the other.
 *
 * ─── Rollover ──────────────────────────────────────────────────────────────
 * Existing rows hold the old bare digests and will no longer verify. Codes
 * expire after ten minutes, so the window is bounded by that: anyone mid-flow
 * across a deploy requests a new code. No migration is needed, and nothing
 * durable is lost.
 */

const encoder = new TextEncoder()
let cachedKey: CryptoKey | null = null

async function hmacKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    // Never fall back to an empty or constant key — that would silently restore
    // exactly the brute-forceable property this module exists to remove.
    throw new Error('BETTER_AUTH_SECRET is required to hash one-time codes')
  }
  cachedKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return cachedKey
}

/** HMAC-SHA256 of a one-time code, hex encoded. */
export async function hashOtp(code: string, domain: 'staff' | 'patient'): Promise<string> {
  const key = await hmacKey()
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`otp:v1:${domain}:${code}`))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Compare two hex digests without leaking where they diverge.
 *
 * The practical risk here is low — an attacker cannot read the stored digest —
 * but a comparison that returns early is the kind of thing that becomes a real
 * problem once the surrounding code is reused somewhere it matters.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
