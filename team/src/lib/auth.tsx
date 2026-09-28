import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { api } from './api'

/**
 * Staff auth — passwordless phone + SMS-OTP (mirrors the patient app). One
 * phone = one staff, so there's no profile picker: verifying the OTP (or a
 * trusted device) issues the session directly.
 *
 * The `/api/staff-auth/*` endpoints still own the rules (active-staff gate, no
 * SMS to unknown numbers, trusted devices), but the session they issue is now a
 * real **Better Auth** session rather than the old custom `staff_session` — see
 * project-docs/auth-consolidation-plan.md. Nothing changed on this side: the
 * endpoints and their payloads are identical and the cookie is HttpOnly either
 * way, so this client never saw the switch.
 */
export interface User {
  id: string
  name: string
  email: string
  image?: string | null
  role?: string | null
  roleId?: string | null
  phone?: string | null
  /** Weekly-breakfast lead — gets the Breakfast submit tab. */
  isBreakfastLead?: boolean
}

export interface StartLoginResult {
  ok: boolean
  /** false → the phone isn't set up for staff sign-in (show the block message). */
  enabled?: boolean
  /** true → an OTP was sent; false → trusted device, complete sign-in directly. */
  requiresOtp?: boolean
  /** Last 4 digits of the destination phone, for display. */
  phoneHint?: string
  error?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  /** Step 1 — submit a phone number. */
  startLogin: (phone: string) => Promise<StartLoginResult>
  /** Step 2 (untrusted device) — verify the SMS code; issues the session. */
  verifyOtp: (phone: string, code: string) => Promise<{ ok: boolean; user?: User; error?: string }>
  /** Trusted-device path — issue the session without an OTP. */
  completeTrustedLogin: (phone: string) => Promise<{ ok: boolean; user?: User; error?: string }>
  signOut: () => Promise<void>
  /** Re-probe `/me` (e.g. after a profile update). */
  refreshSession: () => Promise<void>
}

const AUTH_CACHE_KEY = 'staff_auth_user'

// biome-ignore lint/suspicious/noExplicitAny: backend staff payload is loosely typed
function toUser(s: any): User {
  return {
    id: s.id,
    name: s.fullName || s.name || '',
    email: s.email ?? '',
    image: s.image ?? null,
    role: s.role ?? null,
    roleId: s.roleId ?? null,
    phone: s.phone ?? null,
    isBreakfastLead: s.isBreakfastLead ?? false,
  }
}

function getCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function setCachedUser(user: User | null) {
  try {
    if (user) localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(user))
    else localStorage.removeItem(AUTH_CACHE_KEY)
  } catch {
    // storage disabled — cache just won't persist; harmless
  }
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getCachedUser)
  const [loading, setLoading] = useState(true)

  const refreshSession = useCallback(async () => {
    try {
      const res = await api.get('/api/staff-auth/me', { suppressSessionExpiredHook: true })
      if (res.success && res.staff) {
        const next = toUser(res.staff)
        setUser(next)
        setCachedUser(next)
      } else {
        setUser(null)
        setCachedUser(null)
      }
    } catch {
      // Network error — keep cached user as-is, don't clear.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Skip the auto-probe on patient routes — a staff session has nothing to do
    // with /patient/* and probing there only produces a guaranteed 401.
    if (window.location.pathname.startsWith('/patient')) {
      setLoading(false)
      return
    }
    refreshSession()
  }, [refreshSession])

  const startLogin = async (phone: string): Promise<StartLoginResult> => {
    const res = await api.post(
      '/api/staff-auth/login',
      { phone },
      { suppressSessionExpiredHook: true }
    )
    if (res.enabled === false) return { ok: false, enabled: false, error: res.error }
    if (!res.success) return { ok: false, error: res.error ?? 'Sign-in failed' }
    return {
      ok: true,
      requiresOtp: res.requiresOtp === true,
      phoneHint: typeof res.phoneHint === 'string' ? res.phoneHint : undefined,
    }
  }

  const verifyOtp = async (phone: string, code: string) => {
    const res = await api.post(
      '/api/staff-auth/verify-otp',
      { phone, code },
      { suppressSessionExpiredHook: true }
    )
    if (res.success && res.staff) {
      const next = toUser(res.staff)
      setUser(next)
      setCachedUser(next)
      return { ok: true, user: next }
    }
    return { ok: false, error: res.error ?? 'Invalid or expired code' }
  }

  const completeTrustedLogin = async (phone: string) => {
    const res = await api.post(
      '/api/staff-auth/session',
      { phone },
      { suppressSessionExpiredHook: true }
    )
    if (res.success && res.staff) {
      const next = toUser(res.staff)
      setUser(next)
      setCachedUser(next)
      return { ok: true, user: next }
    }
    return { ok: false, error: res.error ?? 'Could not sign in on this device' }
  }

  const signOut = async () => {
    try {
      await api.post('/api/staff-auth/logout', undefined, { suppressSessionExpiredHook: true })
    } finally {
      setUser(null)
      setCachedUser(null)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        startLogin,
        verifyOtp,
        completeTrustedLogin,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
