/**
 * Rules for the password a person chooses for themselves (F20 / decision D8).
 *
 * `MIN_PASSWORD_LENGTH` mirrors the backend's (`backend/src/lib/password-policy.ts`),
 * which Better Auth enforces on /change-password. Checking it here only spares a round
 * trip; the server is the authority.
 */
export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 128

/**
 * What is wrong with the form, in words for the person, or null when it can be sent.
 * "Same as the one you were given" is refused because the point of the screen is that
 * the administrator who set that password no longer knows the credential.
 */
export function validateNewPassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string
): string | null {
  if (!currentPassword) return 'Enter the password you were given.'
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return `Your new password must be at most ${MAX_PASSWORD_LENGTH} characters.`
  }
  if (newPassword === currentPassword) {
    return 'Choose a password different from the one you were given.'
  }
  if (newPassword !== confirmPassword) return 'The two new passwords do not match.'
  return null
}
