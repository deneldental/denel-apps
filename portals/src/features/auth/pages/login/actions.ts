import { z } from 'zod'
import { checkPortalAccess, NO_PORTAL_ACCESS_MESSAGE } from '@/features/auth/portal-access'
import { authClient } from '@/lib/auth-client'

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Please enter your password.'),
})

/**
 * Portal sign-in — email + password, no OTP step. Better Auth handles session
 * issuance directly. PWA's device-trust OTP lives in a separate layer
 * (/api/staff-auth/*) and never fires on portal.
 */
export async function login(
  email: string,
  password: string
): Promise<{ error?: string; redirectPath?: string }> {
  const parsed = loginSchema.safeParse({ email, password })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please enter both email and password.' }
  }

  try {
    const result = await authClient.signIn.email({
      email: parsed.data.email,
      password: parsed.data.password,
    })

    if (result.error) {
      const status = (result.error as { status?: number }).status
      if (typeof status === 'number') {
        if (status === 429) {
          return { error: 'Too many sign-in attempts. Please wait a minute before trying again.' }
        }
        if (status >= 500) {
          return { error: 'Authentication service error. Please try again shortly.' }
        }
      }
      return { error: 'Invalid email or password.' }
    }

    // A correct password only proves who someone is. Whether they may use the
    // portal is their interface scope — refuse here, with a reason, instead of
    // letting a Team-only account into a portal whose every page bounces back.
    const access = await checkPortalAccess()
    if (access !== 'granted') {
      // Don't leave a session behind for an account that can't use the portal.
      await authClient.signOut().catch(() => {})
      return {
        error:
          access === 'denied'
            ? NO_PORTAL_ACCESS_MESSAGE
            : "Signed in, but we couldn't confirm your portal access. Please try again.",
      }
    }

    return { redirectPath: '/dashboard' }
  } catch (error) {
    console.error('Login error:', error)
    return { error: 'Unable to sign in right now. Please try again.' }
  }
}
