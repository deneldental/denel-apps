import { AlertTriangle, ShieldX } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { isPortalPathAllowed, PORTAL_HOME } from '@/app/route-access'
import { AppointmentAlertMonitor } from '@/features/appointments/components/appointment-alert-monitor'
import { NO_PORTAL_ACCESS_MESSAGE } from '@/features/auth/portal-access'
import { DashboardShell } from '@/features/dashboard/components/dashboard-shell'
import { authClient } from '@/lib/auth-client'
import { useLoading } from '@/lib/loading-context'
import { type PermissionsPayload, PermissionsProvider } from '@/lib/permissions-context'
import { Button } from '@/shared/components/ui/button'

const API_URL = import.meta.env.VITE_API_URL

/**
 * - checking: session + permissions still loading
 * - ready: signed in with portal access — the shell renders
 * - no-portal-access: signed in, but the account has no portal scope
 * - load-failed: the permissions payload could not be loaded
 *
 * The last two used to render the full shell anyway: with no portal scope the
 * guard silently bounced every page to the dashboard, and with no payload it
 * let everything through.
 */
type AccessState = 'checking' | 'ready' | 'no-portal-access' | 'load-failed'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isLoading, startLoading, stopLoading } = useLoading()
  const [userWithRole, setUserWithRole] = useState<any>(null)
  const [permissions, setPermissions] = useState<PermissionsPayload | null>(null)
  const [access, setAccess] = useState<AccessState>('checking')

  // ── Load session + permissions ─────────────────────────────────────────────
  const loadSession = useCallback(async () => {
    try {
      startLoading()
      const { data: sessionData, error } = await authClient.getSession()

      if (error || !sessionData) {
        navigate('/auth/login')
        return
      }

      // An administrator set this password: the person chooses their own before the
      // shell loads (F20 / D8). The backend already refuses every other call, so this
      // is the way forward as much as the guard.
      if (sessionData.user.mustChangePassword) {
        navigate('/auth/change-password', { replace: true })
        return
      }

      setUserWithRole(sessionData.user)

      // Fetch full permission payload — must include X-App-Id so the backend
      // reads the portal session cookie (portal.session_token) instead of the
      // staff-pwa cookie, which could belong to a different user/role.
      const res = await fetch(`${API_URL}/api/auth/permissions`, {
        credentials: 'include',
        headers: { 'X-App-Id': 'portal' },
      })
      if (res.status === 401) {
        navigate('/auth/login')
        return
      }
      const json = res.ok ? await res.json().catch(() => null) : null
      if (!json?.success || !json.data) {
        setAccess('load-failed')
        return
      }

      const payload = json.data as PermissionsPayload
      setPermissions(payload)
      setAccess(payload.isAdmin || payload.scopes.includes('portal') ? 'ready' : 'no-portal-access')
    } catch {
      setAccess('load-failed')
    } finally {
      stopLoading()
    }
  }, [navigate, startLoading, stopLoading])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  const retry = () => {
    setAccess('checking')
    void loadSession()
  }

  const signOut = async () => {
    await authClient.signOut().catch(() => {})
    navigate('/auth/login', { replace: true })
  }

  // ── May the user stay on this page? ────────────────────────────────────────
  // Same rule the sidebar uses to decide which links to offer (route-access).
  const allowedHere =
    access === 'ready' && permissions !== null
      ? isPortalPathAllowed(
          location.pathname,
          permissions.isAdmin ? null : permissions.accessibleModules
        )
      : true

  useEffect(() => {
    if (access !== 'ready' || allowedHere) return
    // A typed or bookmarked URL for a page this role can't open. Say so rather
    // than bouncing silently. The id keeps a double effect run to one toast.
    toast.error("You don't have access to that page.", { id: 'portal-route-denied' })
    navigate(PORTAL_HOME, { replace: true })
  }, [access, allowedHere, navigate])

  if (access === 'no-portal-access') {
    return (
      <AccessProblem
        icon={<ShieldX className="h-6 w-6" />}
        title="No portal access"
        message={NO_PORTAL_ACCESS_MESSAGE}
        onSignOut={signOut}
      />
    )
  }

  if (access === 'load-failed') {
    return (
      <AccessProblem
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Couldn't load your access"
        message="The portal couldn't confirm what this account can open. Check your connection and try again."
        onRetry={retry}
        onSignOut={signOut}
      />
    )
  }

  if (access === 'checking') {
    return (
      <DashboardShell user={userWithRole} isLoading={isLoading}>
        <div />
      </DashboardShell>
    )
  }

  return (
    <PermissionsProvider value={permissions}>
      <DashboardShell user={userWithRole} isLoading={isLoading} permissions={permissions}>
        <AppointmentAlertMonitor />
        {/* Never mount a page the user can't open — not even for the moment
            before the redirect above runs (its data calls would all 403). */}
        {allowedHere ? children : null}
      </DashboardShell>
    </PermissionsProvider>
  )
}

function AccessProblem({
  icon,
  title,
  message,
  onRetry,
  onSignOut,
}: {
  icon: ReactNode
  title: string
  message: string
  onRetry?: () => void
  onSignOut: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        {icon}
      </div>
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      <div className="mt-2 flex gap-2">
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
        <Button variant={onRetry ? 'outline' : 'default'} onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  )
}
