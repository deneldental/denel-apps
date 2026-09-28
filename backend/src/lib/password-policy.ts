/**
 * One password policy, applied at every place a password can be set (L9).
 *
 * There were three rules and no policy: `staff-core.ts` required 10 characters,
 * `staff-portal.ts` required 8, and `routes/users.ts` went through Better Auth
 * and got whatever its default was. The same account could be given a password
 * one route would have rejected, which makes the strongest rule decorative.
 *
 * ─── Why length and not character classes ──────────────────────────────────
 * Deliberately no "must contain an uppercase, a digit and a symbol". NIST
 * SP 800-63B recommends against composition rules: they push people toward
 * predictable mutations (`Password1!`) that are weaker than a longer passphrase,
 * and they are the main reason passwords get written down. Length is the control
 * that actually correlates with strength, so the minimum is raised to 12 and
 * everything else is a denylist of things that are weak regardless of length.
 *
 * ─── What this does NOT do ─────────────────────────────────────────────────
 *   - No breach-corpus check. Doing it properly means a k-anonymity lookup
 *     against Have I Been Pwned on the password-set path, which adds an
 *     outbound network dependency to authentication. Worth adding; it needs a
 *     decision about failure mode (fail open or closed) that belongs to whoever
 *     owns the deployment, not to this file.
 *   - No full reuse history. That needs a password-history table. What IS
 *     enforced is that a reset cannot set the password back to the current one,
 *     which is the case that actually defeats a reset (see `isSameAsCurrent`).
 */

import { verifyPassword } from './password'

export const MIN_PASSWORD_LENGTH = 12
/** Upper bound so a multi-megabyte body cannot turn argon2id into a CPU attack. */
export const MAX_PASSWORD_LENGTH = 200

/**
 * Passwords that are weak no matter how long they are. Not a breach corpus —
 * just the handful that show up in this kind of system, plus the brand names an
 * attacker would try first here.
 */
const DENYLIST = [
  'password',
  'passw0rd',
  'qwerty',
  'letmein',
  'welcome',
  'admin',
  'changeme',
  'denel',
  'framada',
  'dental',
  'clinic',
]

export interface PasswordPolicyResult {
  ok: boolean
  error?: string
}

/**
 * Check a candidate password against the policy.
 *
 * `identifier` is the account's email or staff id when known: a password that
 * contains it is guessable by anyone who knows who the account belongs to,
 * which for staff accounts is everyone in the building.
 */
export function checkPasswordPolicy(
  password: string,
  identifier?: string | null
): PasswordPolicyResult {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'Password is required' }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you can remember is stronger than a short password with symbols in it.`,
    }
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` }
  }

  const lower = password.toLowerCase()

  if (DENYLIST.some((bad) => lower.includes(bad))) {
    return {
      ok: false,
      error:
        'Password contains a word that is too easy to guess. Choose something unrelated to the clinic.',
    }
  }

  // A single repeated character, or a straight run of digits, passes a length
  // check while carrying almost no entropy.
  if (/^(.)\1+$/.test(password)) {
    return { ok: false, error: 'Password cannot be a single repeated character' }
  }
  if (/^\d+$/.test(password)) {
    return { ok: false, error: 'Password cannot be only digits' }
  }

  if (identifier) {
    const local = identifier.split('@')[0]?.toLowerCase().trim()
    if (local && local.length >= 3 && lower.includes(local)) {
      return { ok: false, error: 'Password cannot contain your email address or staff ID' }
    }
  }

  return { ok: true }
}

/**
 * True when the candidate is the account's current password.
 *
 * Without this, a reset can set the password back to what it already was — so
 * an admin resetting a suspected-compromised account, or a user working through
 * a forced change, can end up exactly where they started while everything
 * reports success.
 */
export async function isSameAsCurrent(
  candidate: string,
  currentHash: string | null
): Promise<boolean> {
  if (!currentHash) return false
  try {
    return await verifyPassword({ hash: currentHash, password: candidate })
  } catch {
    return false
  }
}
