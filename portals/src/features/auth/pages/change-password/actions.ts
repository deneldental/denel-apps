import { authClient } from '@/lib/auth-client'

/**
 * The backend's minimum (`MIN_PASSWORD_LENGTH` in backend/src/lib/password-policy.ts).
 * Better Auth enforces it too; checking here only spares a round trip.
 */
export const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128

/**
 * F20 / D8 — the person replaces the password an administrator set for them.
 *
 * `revokeOtherSessions` always: whoever was handed the old password might hold a session,
 * and a forced change that leaves it alive is not a change of hands. Better Auth issues a
 * fresh session for this browser in the same call.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string
): Promise<{ error?: string; success: boolean }> {
  if (!currentPassword) {
    return { error: 'Enter the password you were given.', success: false }
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      success: false,
    }
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return {
      error: `Your new password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
      success: false,
    }
  }
  if (newPassword === currentPassword) {
    return { error: 'Choose a password different from the one you were given.', success: false }
  }
  if (newPassword !== confirmPassword) {
    return { error: 'The two new passwords do not match.', success: false }
  }

  const { error } = await authClient.changePassword({
    currentPassword,
    newPassword,
    revokeOtherSessions: true,
  })

  if (error) {
    if (error.status === 429) {
      return { error: 'Too many attempts — please wait before trying again.', success: false }
    }
    if (error.status === 0) {
      return { error: 'Network error — please check your connection.', success: false }
    }
    if (error.code === 'INVALID_PASSWORD') {
      return { error: 'The password you were given is not correct.', success: false }
    }
    return {
      error: error.message || 'We could not change your password. Please try again.',
      success: false,
    }
  }

  return { success: true }
}
