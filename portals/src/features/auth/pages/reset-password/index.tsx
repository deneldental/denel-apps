import { Loader2 } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { Button } from '@/shared/components/ui/button'
import { Label } from '@/shared/components/ui/label'
import { PasswordInput } from '@/shared/components/ui/password-input'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { resetPassword } from './actions'

function ResetPasswordContent() {
  const [searchParams] = useSearchParams()
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams])
  const errorParam = searchParams.get('error')

  const { isSubmitting, submit } = useSubmitGuard()
  const [state, setState] = useState<{ error?: string; success?: boolean }>({})

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const newPassword = data.get('newPassword') as string
    const confirmPassword = data.get('confirmPassword') as string
    await submit(async () => {
      const result = await resetPassword(token, newPassword, confirmPassword)
      setState(result)
    })
  }

  const invalidToken = errorParam === 'INVALID_TOKEN' || !token

  if (invalidToken && !state?.success) {
    return (
      <AuthLayout
        title="This link has expired"
        description="Password reset links are single-use and time-limited. Request a new one to continue."
      >
        <Button className="w-full" asChild>
          <Link to="/auth/forgot-password">Request a new link</Link>
        </Button>
      </AuthLayout>
    )
  }

  if (state?.success) {
    return (
      <AuthLayout
        title="Password updated"
        description="You can now sign in with your new password."
      >
        <Button className="w-full" asChild>
          <Link to="/auth/login">Go to sign in</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Choose a new password"
      description="Use at least 8 characters."
      footer={
        <Link
          to="/auth/login"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-2">
          <Label htmlFor="newPassword">New password</Label>
          <PasswordInput
            id="newPassword"
            name="newPassword"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
        </div>
        {state?.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
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

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="animate-pulse text-muted-foreground">Loading…</div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  )
}
