import { Button, Input, Label, PasswordInput } from '@denel/ui'
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, Phone } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { AuthShell, BRAND_BUTTON_CLASS } from '../components/auth-shell'

// Phone + SMS-OTP password reset for HR admins. Reuses the backend's proven
// `/api/staff-portal/forgot-password/*` flow (the admin portal uses the same
// endpoints): request an OTP by phone, verify it for a short-lived reset token,
// then set a new password on the matching Better Auth account.
type Step = 'phone' | 'otp' | 'reset' | 'success'

const DESCRIPTIONS: Record<Step, string> = {
  phone: 'Enter your phone number and we’ll text you a verification code.',
  otp: 'Enter the 6-digit code we just sent you.',
  reset: 'Choose a strong new password for your account.',
  success: 'Your password has been updated. You can now sign in with your new password.',
}

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handlePhoneSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!phone.trim()) {
      setError('Please enter your phone number.')
      return
    }
    setSubmitting(true)
    // The backend always reports success here (it never reveals whether a phone
    // is on file), so a truthy `success` just means "proceed to the code step".
    const res = await api.post('/api/staff-portal/forgot-password/request-otp', {
      phone: phone.trim(),
    })
    setSubmitting(false)
    if (!res.success) {
      setError(res.error ?? 'Could not send the code. Please try again.')
      return
    }
    setCode('')
    setStep('otp')
  }

  const handleOtpSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code.')
      return
    }
    setSubmitting(true)
    const res = await api.post('/api/staff-portal/forgot-password/verify-otp', {
      phone: phone.trim(),
      code: code.trim(),
    })
    setSubmitting(false)
    const token = res.resetToken as string | undefined
    if (!res.success || !token) {
      setError(res.error ?? 'Invalid or expired code. Please try again.')
      return
    }
    setResetToken(token)
    setStep('reset')
  }

  const handleResetSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const newPassword = String(form.get('newPassword') ?? '')
    const confirmPassword = String(form.get('confirmPassword') ?? '')
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword.length > 128) {
      setError('Password must be at most 128 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    const res = await api.post('/api/staff-portal/forgot-password/reset', {
      resetToken,
      newPassword,
    })
    setSubmitting(false)
    if (!res.success) {
      setError(res.error ?? 'Could not reset your password. Please request a new code.')
      return
    }
    setStep('success')
  }

  const backToSignIn = (
    <div className="text-center">
      <Link
        to="/auth/login"
        className="text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        <ArrowLeft className="mr-1 inline h-3.5 w-3.5" />
        Back to sign in
      </Link>
    </div>
  )

  return (
    <AuthShell
      headerExtra={
        step === 'success' ? (
          <div className="flex justify-center pt-1">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          </div>
        ) : undefined
      }
      description={DESCRIPTIONS[step]}
    >
      {step === 'phone' && (
        <form onSubmit={handlePhoneSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                placeholder="e.g. 024 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="pl-9"
                required
                autoFocus
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className={`w-full ${BRAND_BUTTON_CLASS}`} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send code
          </Button>
          {backToSignIn}
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={handleOtpSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="code">Verification code</Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="pl-9 text-center font-mono tracking-[0.4em]"
                required
                autoFocus
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className={`w-full ${BRAND_BUTTON_CLASS}`} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Verify code
          </Button>
          <button
            type="button"
            onClick={() => {
              setStep('phone')
              setError(null)
            }}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            <ArrowLeft className="mr-1 inline h-3.5 w-3.5" />
            Use a different number
          </button>
        </form>
      )}

      {step === 'reset' && (
        <form onSubmit={handleResetSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordInput
              id="newPassword"
              name="newPassword"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              required
              minLength={8}
              maxLength={128}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              required
              minLength={8}
              maxLength={128}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className={`w-full ${BRAND_BUTTON_CLASS}`} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reset password
          </Button>
        </form>
      )}

      {step === 'success' && (
        <Button asChild className={`w-full ${BRAND_BUTTON_CLASS}`}>
          <Link to="/auth/login">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to sign in
          </Link>
        </Button>
      )}
    </AuthShell>
  )
}
