import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { PasswordInput } from '@/shared/components/ui/password-input'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { login } from './actions'

export default function LoginPage() {
  const navigate = useNavigate()
  const { isSubmitting, submit } = useSubmitGuard()
  const [error, setError] = useState<string | undefined>()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(undefined)
    const data = new FormData(e.currentTarget)
    const email = data.get('email') as string
    const password = data.get('password') as string
    await submit(async () => {
      const result = await login(email, password)
      if (result.error) {
        setError(result.error)
      } else if (result.redirectPath) {
        navigate(result.redirectPath)
      } else {
        setError('Sign-in failed. Please try again.')
      }
    })
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Use the email your clinic account was set up with."
      footer={
        <Link
          to="/auth/forgot-password"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Forgot your password?
        </Link>
      }
    >
      <form onSubmit={handleSubmit} aria-label="Sign in to your account" className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@denel.com"
            autoComplete="email"
            autoFocus
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" name="password" autoComplete="current-password" required />
        </div>

        {/* role=alert so a failed sign-in is announced, not just shown. */}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </Button>
      </form>
    </AuthLayout>
  )
}
