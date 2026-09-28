import bgUrl from '@denel/assets/login-bg.jpg'
import logoUrl from '@denel/assets/logo.png'
import { AuthShell, OtpForm, PhoneForm } from '@denel/ui/blocks'
import { type FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePatientAuth } from '@/lib/patient-auth'
import { ClinicContactDialog } from './clinic-contact-dialog'
import { ProfilePicker } from './profile-picker'

type Step = 'phone' | 'otp' | 'profiles'

const SUBTITLES: Record<Step, string> = {
  phone: 'Sign in with your phone number',
  otp: 'Verify it’s you',
  profiles: 'Choose who’s signing in',
}

/**
 * Passwordless patient login: phone → OTP (untrusted devices) → family profile
 * picker. The picker activates a profile and lands the user in the app. The
 * phone/OTP presentation comes from the shared `@denel/ui/blocks` auth shell.
 */
export default function LoginPage() {
  const { startLogin, verifyOtp } = usePatientAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [phoneHint, setPhoneHint] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Resend cooldown (seconds) — set when an OTP is sent; counts down to 0.
  const [resendIn, setResendIn] = useState(0)

  // Tick the resend cooldown while on the OTP step.
  useEffect(() => {
    if (step !== 'otp' || resendIn <= 0) return
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [step, resendIn])

  async function handlePhoneSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await startLogin(phone.trim())
    setSubmitting(false)
    if (!res.ok) {
      // enabled === false → the "not enabled, contact administrator" block.
      setError(res.error ?? 'Sign-in failed')
      return
    }
    if (res.requiresOtp) {
      setPhoneHint(res.phoneHint)
      setResendIn(30)
      setStep('otp')
      return
    }
    // Trusted device — straight to the profile picker.
    setStep('profiles')
  }

  async function handleResend() {
    if (resendIn > 0 || submitting) return
    setError(null)
    setCode('')
    setSubmitting(true)
    const res = await startLogin(phone.trim())
    setSubmitting(false)
    if (!res.ok) {
      setError(res.error ?? 'Could not resend the code')
      return
    }
    if (res.phoneHint) setPhoneHint(res.phoneHint)
    setResendIn(30)
  }

  async function verify(value: string) {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const res = await verifyOtp(phone.trim(), value.trim())
    setSubmitting(false)
    if (!res.ok) {
      setError(res.error ?? 'Invalid or expired code')
      return
    }
    setStep('profiles')
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

  return (
    <AuthShell
      bgUrl={bgUrl}
      logoUrl={logoUrl}
      logoAlt="Denel Dental Clinic"
      subtitle={SUBTITLES[step]}
      footer={
        <>
          Trouble signing in? <ClinicContactDialog />
        </>
      }
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
      {step === 'profiles' && (
        <ProfilePicker onSelected={() => navigate('/patient/home', { replace: true })} />
      )}
    </AuthShell>
  )
}
