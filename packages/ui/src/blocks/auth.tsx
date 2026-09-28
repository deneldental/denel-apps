import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Loader2, Phone } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { Button } from '../button'
import { Input } from '../input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../input-otp'
import { Label } from '../label'

/**
 * Presentational auth blocks — the branded passwordless (phone → OTP) sign-in
 * look, shared by the patient + team PWAs. Pure UI: the consuming page owns all
 * auth state + handlers and passes them in. Colours come from theme tokens
 * (`brand` / `primary`), so each app renders in its own palette.
 */

// ── AuthShell ────────────────────────────────────────────────────────────────
// Full-screen frame: background photo + brand→primary scrim + centered glass
// card with logo and step subtitle. The current step renders as `children`.

export interface AuthShellProps {
  /** Full-bleed background image URL. */
  bgUrl: string
  /** Brand logo (wordmark) URL, shown centered in the card. */
  logoUrl: string
  logoAlt?: string
  /** Step subtitle under the logo. */
  subtitle: string
  /** Optional line under the card (e.g. a "trouble signing in?" link). */
  footer?: ReactNode
  children: ReactNode
}

export function AuthShell({
  bgUrl,
  logoUrl,
  logoAlt = '',
  subtitle,
  footer,
  children,
}: AuthShellProps) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgUrl})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-brand/40 via-primary/65 to-primary/90" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="rounded-3xl border border-white/10 bg-card p-6 shadow-2xl sm:p-7">
          <div className="mb-6 flex flex-col items-center text-center">
            <img src={logoUrl} alt={logoAlt} className="mb-3 w-24" />
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children}
        </div>
        {footer && <p className="mt-6 text-center text-xs text-white/80">{footer}</p>}
      </div>
    </div>
  )
}

// ── PhoneForm ────────────────────────────────────────────────────────────────
// Phone-number step: labelled tel input with a phone icon + submit button.

export interface PhoneFormProps {
  phone: string
  onPhoneChange: (value: string) => void
  onSubmit: (e: FormEvent) => void
  submitting?: boolean
  error?: string | null
  placeholder?: string
  help?: string
  submitLabel?: string
}

export function PhoneForm({
  phone,
  onPhoneChange,
  onSubmit,
  submitting = false,
  error,
  placeholder = 'e.g. 024 123 4567',
  help = 'We’ll text you a one-time code.',
  submitLabel = 'Continue',
}: PhoneFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone number</Label>
        <div className="relative">
          <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={placeholder}
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            required
            autoFocus
            className="h-12 rounded-xl pl-10"
          />
        </div>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      <Button
        type="submit"
        disabled={submitting}
        className="h-12 w-full rounded-xl text-base font-semibold"
      >
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  )
}

// ── OtpForm ──────────────────────────────────────────────────────────────────
// One-time-code step: 6 slot inputs (auto-advance) + verify + resend/back.

export interface OtpFormProps {
  code: string
  onCodeChange: (value: string) => void
  onSubmit: (e: FormEvent) => void
  onResend: () => void
  onBack: () => void
  /** Seconds left on the resend cooldown (0 = resend enabled). */
  resendIn: number
  /** Masked tail of the phone number, shown in the prompt. */
  phoneHint?: string
  submitting?: boolean
  error?: string | null
  submitLabel?: string
}

export function OtpForm({
  code,
  onCodeChange,
  onSubmit,
  onResend,
  onBack,
  resendIn,
  phoneHint,
  submitting = false,
  error,
  submitLabel = 'Verify',
}: OtpFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <p className="text-center text-sm text-muted-foreground">
        Enter the 6-digit code we sent{phoneHint ? ` to …${phoneHint}` : ''}.
      </p>
      <InputOTP
        maxLength={6}
        pattern={REGEXP_ONLY_DIGITS}
        value={code}
        onChange={onCodeChange}
        disabled={submitting}
        autoFocus
        containerClassName="w-full"
      >
        <InputOTPGroup className="flex w-full justify-between gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <InputOTPSlot
              key={i}
              index={i}
              className="h-12 w-12 rounded-xl border text-lg data-[active=true]:border-brand data-[active=true]:ring-2 data-[active=true]:ring-brand/40"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        disabled={submitting}
        className="h-12 w-full rounded-xl text-base font-semibold"
      >
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
      <div className="space-y-2 text-center">
        <button
          type="button"
          onClick={onResend}
          disabled={resendIn > 0 || submitting}
          className="w-full text-xs font-medium text-brand transition-colors hover:text-brand/80 disabled:text-muted-foreground disabled:hover:text-muted-foreground"
        >
          {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="w-full text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Use a different number
        </button>
      </div>
    </form>
  )
}
