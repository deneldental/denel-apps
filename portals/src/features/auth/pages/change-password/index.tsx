import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/shared/components/ui/button'
import { Label } from '@/shared/components/ui/label'
import { PasswordInput } from '@/shared/components/ui/password-input'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { changePassword, MIN_PASSWORD_LENGTH } from './actions'

/**
 * F20 / D8 — where a signed-in person lands when an administrator set their password.
 *
 * The dashboard guard sends a flagged session here and the backend refuses every other
 * call until the password is changed (rbac/middleware/enforcePasswordChange), so this page
 * is the only way forward. It needs a session: without one it goes to sign-in.
 */
export default function ChangePasswordPage() {
  const navigate = useNavigate()
  const { isSubmitting, submit } = useSubmitGuard()
  const [error, setError] = useState<string | undefined>()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    authClient
      .getSession()
      .then(({ data }) => {
        if (cancelled) return
        if (!data?.user) navigate('/auth/login', { replace: true })
        else setChecking(false)
      })
      .catch(() => {
        if (!cancelled) navigate('/auth/login', { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(undefined)
    const data = new FormData(e.currentTarget)
    const current = data.get('currentPassword') as string
    const next = data.get('newPassword') as string
    const confirm = data.get('confirmPassword') as string
    await submit(async () => {
      const result = await changePassword(current, next, confirm)
      if (result.success) navigate('/dashboard', { replace: true })
      else setError(result.error)
    })
  }

  async function handleSignOut() {
    await authClient.signOut().catch(() => {})
    navigate('/auth/login', { replace: true })
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <AuthLayout
      title="Choose your own password"
      description="An administrator set your password, so they know it. Choose one only you know to continue."
      footer={
        <button
          type="button"
          onClick={handleSignOut}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Sign out
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="currentPassword">Password you were given</Label>
          <PasswordInput
            id="currentPassword"
            name="currentPassword"
            autoComplete="current-password"
            required
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPassword">New password</Label>
          <PasswordInput
            id="newPassword"
            name="newPassword"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={128}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={128}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Updating password…
            </>
          ) : (
            'Update password'
          )}
        </Button>
      </form>
    </AuthLayout>
  )
}
