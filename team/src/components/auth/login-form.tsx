import bgFallback from '@denel/assets/login-bg.jpg'
import logoFallback from '@denel/assets/logo.png'
import { AuthShell, OtpForm, PhoneForm } from '@denel/ui/blocks'
import { type FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { getHomeForRole } from '@/shared/lib/role-routing'

// Team app — staff sign in with their phone number + a one-time SMS code
// (passwordless; mirrors the patient app). One phone = one staff. Presentation
// comes from the shared `@denel/ui/blocks` auth shell, so it matches patient.

type Step = 'phone' | 'otp'

const RESEND_COOLDOWN_S = 30

const SUBTITLES: Record<Step, string> = {
  phone: 'Sign in with your phone number',
  otp: 'Verify it’s you',
}

export function LoginForm() {
  const { startLogin, verifyOtp, completeTrustedLogin } = useAuth()
  const branding = useBranding()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [phoneHint, setPhoneHint] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  // Tick the resend cooldown while on the OTP step.
  useEffect(() => {
    if (step !== 'otp' || resendIn <= 0) return
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [step, resendIn])

  function goHome(user?: { roleId?: string | null; role?: string | null }) {
    navigate(getHomeForRole(user?.roleId ?? user?.role ?? null), { replace: true })
  }

  async function handlePhoneSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!phone.trim()) {
      setError('Please enter your phone number')
      return
    }
    setSubmitting(true)
    const res = await startLogin(phone.trim())
    if (res.enabled === false) {
      setSubmitting(false)
      setError(
        res.error ??
          "This phone number isn't set up for staff sign-in. Please contact your administrator."
      )
      return
    }
    if (!res.ok) {
      setSubmitting(false)
      setError(res.error ?? 'Could not start sign-in. Please try again.')
      return
    }
    if (res.requiresOtp) {
      setPhoneHint(res.phoneHint ?? undefined)
      setCode('')
      setResendIn(RESEND_COOLDOWN_S)
      setStep('otp')
      setSubmitting(false)
      return
    }
    // Trusted device — no OTP needed.
    const done = await completeTrustedLogin(phone.trim())
    setSubmitting(false)
    if (done.ok) goHome(done.user)
    else setError(done.error ?? 'Could not sign in on this device.')
  }

  async function verify(value: string) {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const res = await verifyOtp(phone.trim(), value.trim())
    setSubmitting(false)
    if (res.ok) goHome(res.user)
    else setError(res.error ?? 'Invalid or expired code')
  }

  function handleOtpSubmit(e: FormEvent) {
    e.preventDefault()
    verify(code)
  }

  // Auto-submit once all six digits are entered.
  function handleOtpChange(value: string) {
    setCode(value)
    if (value.length === 6) verify(value)
  }

  async function handleResend() {
    if (resendIn > 0 || submitting) return
    setError(null)
    setCode('')
    setSubmitting(true)
    const res = await startLogin(phone.trim())
    setSubmitting(false)
    if (res.ok && res.requiresOtp) {
      setPhoneHint(res.phoneHint ?? phoneHint)
      setResendIn(RESEND_COOLDOWN_S)
    } else if (res.enabled === false) {
      setError(res.error ?? 'This phone number is no longer set up for sign-in.')
    } else {
      setError(res.error ?? 'Could not resend the code.')
    }
  }

  return (
    <AuthShell
      bgUrl={branding.pwaLoginImageUrl ?? bgFallback}
      logoUrl={branding.logoHorizontalUrl ?? logoFallback}
      logoAlt={branding.name}
      subtitle={SUBTITLES[step]}
    >
      {step === 'phone' && (
        <PhoneForm
          phone={phone}
          onPhoneChange={setPhone}
          onSubmit={handlePhoneSubmit}
          submitting={submitting}
          error={error}
        />
      )}
      {step === 'otp' && (
        <OtpForm
          code={code}
          onCodeChange={handleOtpChange}
          onSubmit={handleOtpSubmit}
          onResend={handleResend}
          onBack={() => {
            setStep('phone')
            setCode('')
            setError(null)
          }}
          resendIn={resendIn}
          phoneHint={phoneHint}
          submitting={submitting}
          error={error}
        />
      )}
    </AuthShell>
  )
}
