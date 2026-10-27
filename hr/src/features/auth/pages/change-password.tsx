import { MIN_PASSWORD_LENGTH, validateNewPassword } from '@denel/app-kit'
import { Button, Label, PasswordInput } from '@denel/ui'
import { Loader2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { resetHrScopeAccess } from '@/lib/hr-scope-check'
import { AuthShell, BRAND_BUTTON_CLASS } from '../components/auth-shell'

/**
 * F20 / D8 — where a signed-in person lands when an administrator set their password.
 *
 * `RequireAuth` (app-kit) sends a flagged session here and the backend refuses every
 * other call until the password is changed, so this is the only way forward. This route
 * sits inside `RequireAuth` (it needs the session) but outside `RequireHrAccess`: choosing
 * a password does not depend on holding the HR scope.
 */
export default function ChangePasswordPage() {
  const { changePassword, signOut } = useAuth()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const problem = validateNewPassword(current, next, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setSubmitting(true)
    try {
      const result = await changePassword(current, next)
      if (result.success) navigate('/dashboard', { replace: true })
      else setError(result.error ?? 'We could not change your password. Please try again.')
    } catch {
      setError('We could not change your password — check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    resetHrScopeAccess()
    await signOut()
    navigate('/auth/login', { replace: true })
  }

  return (
    <AuthShell description="An administrator set your password, so they know it. Choose one only you know to continue.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="currentPassword">Password you were given</Label>
          <PasswordInput
            id="currentPassword"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <PasswordInput
            id="newPassword"
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className={`w-full ${BRAND_BUTTON_CLASS}`} disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Update password
        </Button>
        <div className="text-center">
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Sign out
          </button>
        </div>
      </form>
    </AuthShell>
  )
}
