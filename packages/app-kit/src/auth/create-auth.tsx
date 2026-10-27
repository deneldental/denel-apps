/**
 * Auth factory — email + password flow (portal / hr).
 *
 * `createAuth(config)` builds a Better Auth client bound to one app's backend +
 * `X-App-Id`, and returns the React glue (AuthProvider / useAuth / RequireAuth)
 * closed over that client. Encapsulating the client inside the factory keeps
 * Better Auth's generics from leaking across the package boundary.
 *
 * The PWA's staff-ID + OTP flow is a separate concern and does NOT use this
 * factory.
 */
import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { Loader2 } from 'lucide-react'
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { Navigate, useLocation } from 'react-router-dom'

/**
 * User shape surfaced by Better Auth's session:
 *  - core `user` table (id, name, email, image)
 *  - `additionalFields` (roleId, phone, mustChangePassword)
 *  - the `admin` plugin's `role` string
 */
export interface User {
  id: string
  name: string
  email: string
  image?: string | null
  role?: string | null
  roleId?: string | null
  phone?: string | null
  /**
   * F20 / D8 — an administrator set this person's password, so they must choose their
   * own before anything else. `RequireAuth` sends them to `changePasswordPath`; the
   * backend refuses every other call until they have.
   */
  mustChangePassword?: boolean
}

export interface AuthConfig {
  /** Better Auth base URL (usually same as the API URL). */
  baseURL: string
  /** App identifier sent as `X-App-Id` (e.g. 'portal' | 'hr'). */
  appId: string
  /** localStorage key for the cached user (namespace per app). */
  cacheKey: string
  /** Where RequireAuth redirects when there's no session. Defaults to /auth/login. */
  loginPath?: string
  /**
   * Where RequireAuth sends a person who must choose a new password. The route that
   * renders this screen must be inside RequireAuth (it needs the session) — RequireAuth
   * lets that one path through. Defaults to /auth/change-password.
   */
  changePasswordPath?: string
}

export interface AuthContextValue {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
  /**
   * Replace the signed-in person's password and end every other session. Refreshes the
   * session on success, so `user.mustChangePassword` clears.
   */
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>
}

function buildAuthClient(baseURL: string, appId: string) {
  return createAuthClient({
    baseURL,
    // Bounded the same as the REST API client's DEFAULT_TIMEOUT_MS — without
    // this, better-fetch never starts an abort timer, so a stalled backend
    // leaves getSession()/signIn()/signOut() hanging forever with no error.
    fetchOptions: { headers: { 'X-App-Id': appId }, timeout: 30_000 },
    plugins: [
      adminClient(),
      inferAdditionalFields({
        user: {
          roleId: { type: 'string', required: false },
          phone: { type: 'string', required: false },
          mustChangePassword: { type: 'boolean', required: false },
        },
      }),
    ],
  })
}

export interface DenelAuth {
  authClient: ReturnType<typeof buildAuthClient>
  AuthProvider: ComponentType<{ children: ReactNode }>
  useAuth: () => AuthContextValue
  RequireAuth: ComponentType<{ children: ReactNode }>
}

type RawUser = {
  id: string
  name: string
  email: string
  image?: string | null
  role?: string | null
  roleId?: string | null
  phone?: string | null
  mustChangePassword?: boolean | null
}

function toUser(data: RawUser): User {
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    image: data.image ?? null,
    role: data.role ?? null,
    roleId: data.roleId ?? null,
    phone: data.phone ?? null,
    mustChangePassword: data.mustChangePassword === true,
  }
}

export function createAuth(config: AuthConfig): DenelAuth {
  const authClient = buildAuthClient(config.baseURL, config.appId)
  const loginPath = config.loginPath ?? '/auth/login'
  const changePasswordPath = config.changePasswordPath ?? '/auth/change-password'
  const cacheKey = config.cacheKey

  function getCachedUser(): User | null {
    try {
      const raw = localStorage.getItem(cacheKey)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  function setCachedUser(user: User | null) {
    if (user) localStorage.setItem(cacheKey, JSON.stringify(user))
    else localStorage.removeItem(cacheKey)
  }

  const AuthContext = createContext<AuthContextValue | null>(null)

  function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(getCachedUser)
    const [loading, setLoading] = useState(true)

    const refreshSession = useCallback(async () => {
      try {
        const { data, error } = await authClient.getSession()
        if (error) return // network/server error — keep cached user
        if (data?.user) {
          const next = toUser(data.user as RawUser)
          setUser(next)
          setCachedUser(next)
        } else {
          setUser(null)
          setCachedUser(null)
        }
      } catch {
        // unexpected error — keep cached, don't clear
      } finally {
        setLoading(false)
      }
    }, [])

    useEffect(() => {
      refreshSession()
    }, [refreshSession])

    const signIn = async (email: string, password: string) => {
      const { data, error } = await authClient.signIn.email({ email, password })
      if (error) return { success: false, error: error.message || 'Invalid credentials' }
      if (!data?.user) return { success: false, error: 'Sign-in returned no user' }
      const next = toUser(data.user as RawUser)
      setUser(next)
      setCachedUser(next)
      return { success: true }
    }

    const signOut = async () => {
      try {
        await authClient.signOut()
      } finally {
        setUser(null)
        setCachedUser(null)
      }
    }

    const changePassword = async (currentPassword: string, newPassword: string) => {
      // revokeOtherSessions: whoever was handed the old password might hold a session.
      // Better Auth issues this browser a fresh one in the same call.
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (error) {
        if (error.status === 429) {
          return { success: false, error: 'Too many attempts — please wait before trying again.' }
        }
        if (error.code === 'INVALID_PASSWORD') {
          return { success: false, error: 'The password you were given is not correct.' }
        }
        return {
          success: false,
          error: error.message || 'We could not change your password. Please try again.',
        }
      }
      await refreshSession()
      return { success: true }
    }

    return (
      <AuthContext.Provider
        value={{ user, loading, signIn, signOut, refreshSession, changePassword }}
      >
        {children}
      </AuthContext.Provider>
    )
  }

  function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within AuthProvider')
    return ctx
  }

  function RequireAuth({ children }: { children: ReactNode }) {
    const { user, loading } = useAuth()
    const location = useLocation()
    if (loading && !user) {
      return (
        <div className="flex h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )
    }
    if (!user) return <Navigate to={loginPath} replace />
    // An administrator set this password: nothing else until the person has chosen their
    // own (F20 / D8). The change-password route itself is the one way through.
    if (user.mustChangePassword && location.pathname !== changePasswordPath) {
      return <Navigate to={changePasswordPath} replace />
    }
    return <>{children}</>
  }

  return { authClient, AuthProvider, useAuth, RequireAuth }
}
