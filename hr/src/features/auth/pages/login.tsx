import { Button, Input, Label, PasswordInput } from '@denel/ui'
import { Loader2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { resetHrScopeAccess } from '@/lib/hr-scope-check'
import { AuthShell, BRAND_BUTTON_CLASS } from '../components/auth-shell'

export default function LoginPage() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Already signed in → bounce to dashboard.
  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
  }, [user, navigate])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // The HR scope check runs once at page load and is cached — while signed
      // out, that result is "no access". Drop it before signing in so the
      // dashboard re-checks with the new session instead of showing
      // "No HR access" until Retry or a reload.
      resetHrScopeAccess()
      const result = await signIn(email, password)
      if (result.success) {
        navigate('/dashboard', { replace: true })
      } else {
        setError(result.error ?? 'Sign-in failed')
      }
    } catch {
      setError('Sign-in failed — check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell description="Sign in to the HR admin portal">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className={`w-full ${BRAND_BUTTON_CLASS}`} disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign in
        </Button>
        <div className="text-center">
          <Link
            to="/auth/forgot-password"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
