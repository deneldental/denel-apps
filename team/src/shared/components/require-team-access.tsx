import { ShieldX } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { RouteSkeleton } from './route-skeleton'

type Gate = 'checking' | 'allowed' | 'denied'

/**
 * Interface-scope gate for the Team app — the mirror of the HR app's
 * `RequireHrAccess`. Verifies the signed-in user holds the `'pwa'` interface
 * scope via `/api/auth/scope-access?scope=pwa`.
 *
 * The Team app is personal self-service (payslip, attendance, requests,
 * training) plus the lab bench. `receptionist`, `staff` and `lab_technician`
 * hold the scope; `doctor`, `admin` and `hr_admin` deliberately do not — their
 * work belongs on the portal or in the HR app.
 *
 * Without this, a revoked user signs in successfully, gets routed to a home
 * page, and then watches every request 403. This turns that into one clear
 * answer at the door.
 */
export function RequireTeamAccess({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('checking')
  const { signOut } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    api
      .get<{ hasAccess: boolean; scope: string }>('/api/auth/scope-access?scope=pwa')
      .then((res) => {
        if (cancelled) return
        setGate(res.success && res.data?.hasAccess ? 'allowed' : 'denied')
      })
      .catch(() => {
        if (!cancelled) setGate('denied')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (gate === 'checking') return <RouteSkeleton />

  if (gate === 'denied') {
    const handleSignOut = async () => {
      await signOut()
      navigate('/login', { replace: true })
    }
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldX className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">Use the clinic portal</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This app is for personal records and lab work. Your account does its work in the clinic
          portal instead. If you believe this is a mistake, contact an administrator.
        </p>
        <Button variant="outline" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    )
  }

  return <>{children}</>
}
