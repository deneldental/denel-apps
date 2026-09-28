import { authClient } from '@/lib/auth-client'

export async function resetPassword(
  token: string,
  newPassword: string,
  confirmPassword: string
): Promise<{ error?: string; success: boolean }> {
  if (!token) {
    return { error: 'Invalid or expired reset link. Please request a new one.', success: false }
  }
  if (!newPassword || newPassword.length < 8) {
    return { error: 'Password must be at least 8 characters.', success: false }
  }
  if (newPassword.length > 128) {
    return { error: 'Password must be at most 128 characters.', success: false }
  }
  if (newPassword !== confirmPassword) {
    return { error: 'Passwords do not match.', success: false }
  }

  const { error } = await authClient.resetPassword({
    newPassword,
    token,
  })

  if (error) {
    if (error.status === 429) {
      return { error: 'Too many attempts — please wait before trying again.', success: false }
    }
    if (error.status === 0) {
      return { error: 'Network error — please check your connection.', success: false }
    }
    return {
      error: error.message ?? 'Invalid or expired link. Please request a new reset link.',
      success: false,
    }
  }

  return { success: true }
}
