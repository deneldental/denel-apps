import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { PasswordInput } from '@/shared/components/ui/password-input'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { requestForgotOtp, resetForgotPassword, verifyForgotOtp } from './actions'

type Step = 'phone' | 'otp' | 'reset' | 'success'

const COPY: Record<Step, { title: string; description?: string }> = {
  phone: {
    title: 'Reset your password',
    description: "We'll text a 6-digit code to the phone number on your account.",
  },
  otp: { title: 'Enter the code' },
  reset: {
    title: 'Choose a new password',
    description: 'Use at least 8 characters.',
  },
  success: {
    title: 'Password updated',
    description: 'You can now sign in with your new password.',
  },
}

function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}

export default function ForgotPasswordPage() {
  const { isSubmitting, submit } = useSubmitGuard()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [error, setError] = useState<string | undefined>()

  async function handlePhoneSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(undefined)
    if (!phone.trim()) {
      setError('Enter the phone number on your account.')
      return
    }

    await submit(async () => {
      const res = await requestForgotOtp(phone.trim())
      if (res.success) {
        setStep('otp')
      } else {
        setError(res.error || "That code couldn't be sent. Check the number and try again.")
      }
    })
  }

  async function handleOtpSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(undefined)
    if (!code.trim()) {
      setError('Enter the 6-digit code.')
      return
    }

    await submit(async () => {
      const res = await verifyForgotOtp(phone.trim(), code.trim())
      if (res.success && res.resetToken) {
        setResetToken(res.resetToken)
        setStep('reset')
      } else {
        setError(res.error || 'That code is invalid or has expired. Request a new one.')
      }
    })
  }

  async function handleResetSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(undefined)
    const data = new FormData(e.currentTarget)
    const newPassword = data.get('newPassword') as string
    const confirmPassword = data.get('confirmPassword') as string

    if (newPassword.length < 8) {
      setError('Use at least 8 characters.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError("Those passwords don't match.")
      return
    }

    await submit(async () => {
      const res = await resetForgotPassword(resetToken, newPassword)
      if (res.success) {
        setStep('success')
      } else {
        setError(res.error || "That password couldn't be saved. Try again.")
      }
    })
  }

  const backToSignIn = (
    <Link
      to="/auth/login"
      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      Back to sign in
    </Link>
  )

  return (
    <AuthLayout
      title={COPY[step].title}
      description={
        step === 'otp' ? (
          <>We sent a 6-digit code to the number ending {phone.slice(-4)}.</>
        ) : (
          COPY[step].description
        )
      }
      footer={step === 'phone' || step === 'reset' ? backToSignIn : undefined}
    >
      {step === 'phone' && (
        <form onSubmit={handlePhoneSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+233 24 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              required
              autoFocus
            />
          </div>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending code…
              </>
            ) : (
              'Send code'
            )}
          </Button>
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={handleOtpSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="text-center font-mono text-lg tracking-[0.4em]"
              autoComplete="one-time-code"
              required
              autoFocus
            />
          </div>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying…
              </>
            ) : (
              'Verify code'
            )}
          </Button>
          <button
            type="button"
            onClick={() => {
              setError(undefined)
              setStep('phone')
            }}
            className="w-full text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Use a different number
          </button>
        </form>
      )}

      {step === 'reset' && (
        <form onSubmit={handleResetSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordInput
              id="newPassword"
              name="newPassword"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
              minLength={8}
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
            />
          </div>
          <FormError message={error} />
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
      )}

      {step === 'success' && (
        <Button className="w-full" asChild>
          <Link to="/auth/login">Go to sign in</Link>
        </Button>
      )}
    </AuthLayout>
  )
}
