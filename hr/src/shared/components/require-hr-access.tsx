import { RouteSkeleton } from '@denel/app-kit'
import { Button } from '@denel/ui'
import { AlertTriangle, ShieldX } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { getHrScopeAccess, resetHrScopeAccess } from '@/lib/hr-scope-check'

type Gate = 'checking' | 'allowed' | 'denied' | 'error'

/**
 * Interface-scope gate for the HR app. Verifies the user holds the `'hr'`
 * interface scope via the backend (`/api/auth/scope-access?scope=hr`). Admin
 * bypasses on the backend; `hr_admin` and `external_trainer` are granted.
 * Anyone else (e.g. a clinical-only role who somehow reaches the HR origin)
 * is blocked here even though their session is valid.
 *
 * The scope-check fetch itself starts eagerly at module load (see
 * `hr-scope-check.ts`), in parallel with `RequireAuth`'s own session check,
 * rather than only starting once this component mounts as `RequireAuth`'s
 * child — that used to make the two checks run strictly in series.
 */
export function RequireHrAccess({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('checking')
  const [attempt, setAttempt] = useState(0)
  const { signOut, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is unread, only bumped by Retry to force a re-run
  useEffect(() => {
    let cancelled = false
    getHrScopeAccess()
      .then((res) => {
        if (cancelled) return
        if (res.success) setGate(res.data?.hasAccess ? 'allowed' : 'denied')
        else setGate('error')
      })
      .catch(() => {
        if (!cancelled) setGate('error')
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  // A stale cached user can let RequireAuth render this component before the
  // real session check resolves — don't commit to "denied"/"error" off a
  // check that might still be overturned once the real session is confirmed.
  if (gate === 'checking' || (authLoading && gate !== 'allowed')) {
    return <RouteSkeleton label="Checking access…" />
  }

  if (gate === 'denied' || gate === 'error') {
    const handleSignOut = async () => {
      resetHrScopeAccess()
      await signOut()
      navigate('/auth/login', { replace: true })
    }
    const handleRetry = () => {
      resetHrScopeAccess()
      setGate('checking')
      setAttempt((n) => n + 1)
    }
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          {gate === 'error' ? (
            <AlertTriangle className="h-6 w-6" />
          ) : (
            <ShieldX className="h-6 w-6" />
          )}
        </div>
        <h1 className="text-lg font-semibold">
          {gate === 'error' ? "Couldn't check access" : 'No HR access'}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {gate === 'error'
            ? "We couldn't reach the server to verify your access. This is usually temporary."
            : "Your account isn't granted access to the HR app. If you believe this is a mistake, contact an administrator."}
        </p>
        <div className="flex gap-2">
          {gate === 'error' && (
            <Button variant="default" onClick={handleRetry}>
              Retry
            </Button>
          )}
          <Button variant="outline" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
