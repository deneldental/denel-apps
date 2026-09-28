import logoFallback from '@denel/assets/logo.png'
import { formatGhanaCardPin, GENDERS, GHANA_CARD_DIGITS, MARITAL_STATUSES } from '@denel/types'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { type RegistrationLookup, registrationApi } from '@/lib/api'
import { useBranding } from '@/lib/branding'

// Public staff self-registration. Reached at team.deneldental.com/register/:token from an
// admin-generated 24h link. Flow: validate token → phone-OTP gate → fill the 4
// staff-owned sections + optional CV + consent → submit → HR approves later.

// Option VALUES come from the canonical vocabularies in @denel/types — the
// same ones the backend validates against and the HR app renders. Only the
// human labels live here. These lists used to be hand-written in both forms
// independently, which is exactly how the HR editor ended up storing
// `vodafone` while this form stored `telecel`, leaving a self-registered
// staffer's payout network rendering blank in HR.
const label = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }))

const GENDER_OPTIONS = label(GENDERS, {
  male: 'Male',
  female: 'Female',
})
const MARITAL_OPTIONS = label(MARITAL_STATUSES, {
  single: 'Single',
  married: 'Married',
  divorced: 'Divorced',
  widowed: 'Widowed',
})
// Department is an admin-managed lookup (hr-departments), fetched at runtime —
// so a department the clinic added appears here without a deploy. No hardcoded
// list; mobile-money options are gone (bank-only, matching the HR form).

const CONSENT_TEXT =
  'I consent to Denel Dental Clinic collecting and processing my personal information for employment and payroll purposes, in line with the Data Protection Act, 2012 (Act 843).'

type Phase = 'validating' | 'invalid' | 'gate' | 'form' | 'submitted'
type FormState = Record<string, string>

const INVALID_COPY: Record<string, { title: string; body: string }> = {
  not_found: { title: 'Link not found', body: 'This registration link is invalid.' },
  expired: {
    title: 'Link expired',
    body: 'This registration link has expired. Please ask the clinic for a new one.',
  },
  already_submitted: {
    title: 'Already submitted',
    body: 'This registration has already been submitted and is awaiting review.',
  },
  already_approved: {
    title: 'Already completed',
    body: 'This registration is complete. You can now sign in with your phone number.',
  },
  rejected: {
    title: 'Registration closed',
    body: 'This registration link is no longer active. Please contact the clinic.',
  },
  error: { title: 'Something went wrong', body: 'Please try again in a moment.' },
}

// ── Small field helpers ──────────────────────────────────────────────────────

function Field({
  label,
  required,
  htmlFor,
  hint,
  children,
}: {
  label: string
  required?: boolean
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  )
}

// ── Steps ────────────────────────────────────────────────────────────────────
//
// This was one long form. On a phone that meant ~40 fields in a single column
// inside an app shell that locks document scrolling (html/body/#root have
// `overflow: hidden` so the PWA feels native) — so everything below the fold was
// simply unreachable and the form could not be completed at all. Now: one
// section per step, each step its own scroll pane.
//
// The steps mirror the numbered sections staff already saw (1. Personal,
// 2. Employment, …) so the flow is unchanged, just paged.

type StepId = 1 | 2 | 3 | 4

// Aligned with the HR admin form: Education dropped (it's on the CV), so the
// step count drops from 5 to 4.
const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 1, label: 'Personal' },
  { id: 2, label: 'Employment' },
  { id: 3, label: 'Emergency' },
  { id: 4, label: 'Finish' },
]

const LAST_STEP: StepId = 4

/**
 * Required fields per step, mirroring `registrationSubmitSchema` in
 * @denel/types (which the submit endpoint validates against). Kept in step
 * order so a staffer is told what's missing on the step they're standing on,
 * rather than after a submit that lists everything at once.
 *
 * Bank details, the Ghana Card format and consent are cross-field/format rules,
 * handled in validateStep below, not here.
 *
 * Department and date of joining are OPTIONAL now, matching the HR form — HR
 * sets them at approval if the registrant leaves them blank.
 */
const REQUIRED_BY_STEP: Record<StepId, Array<[field: string, label: string]>> = {
  1: [
    ['fullName', 'Full legal name'],
    ['dateOfBirth', 'Date of birth'],
    ['gender', 'Gender'],
    ['maritalStatus', 'Marital status'],
    // ghanaCard is validated by the length/format check in validateStep (the
    // input stores digits under `ghanaCardDigits`), not by this presence list.
    ['residentialAddress', 'Residential address'],
    ['digitalAddress', 'Digital address'],
    ['nextOfKinName', 'Next of kin name'],
    ['nextOfKinRelationship', 'Next of kin relationship'],
    ['nextOfKinPhone', 'Next of kin phone'],
  ],
  2: [['title', 'Title / clinical position']],
  3: [
    ['emergencyContactName', 'Emergency contact name'],
    ['emergencyContactRelationship', 'Emergency contact relationship'],
    ['emergencyContactPhone', 'Emergency contact phone'],
  ],
  4: [],
}

export default function RegisterPage() {
  const { token = '' } = useParams()
  const branding = useBranding()

  const [phase, setPhase] = useState<Phase>('validating')
  const [invalidReason, setInvalidReason] = useState<string>('error')

  // Phone-OTP gate
  const [gatePhone, setGatePhone] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [verifiedPhone, setVerifiedPhone] = useState('')

  // Form
  const [titles, setTitles] = useState<RegistrationLookup[]>([])
  const [departments, setDepartments] = useState<RegistrationLookup[]>([])
  const [form, setForm] = useState<FormState>({ nationality: 'Ghanaian' })
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [cvName, setCvName] = useState<string | null>(null)
  const [cvUploading, setCvUploading] = useState(false)
  const [consent, setConsent] = useState(false)

  const [step, setStep] = useState<StepId>(1)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const cvInputRef = useRef<HTMLInputElement>(null)
  // The document can't scroll (app-shell locks it), so this pane is what
  // scrolls — and what has to be reset to the top on each step change.
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const set = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Validate token + preload titles on mount.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const res = (await registrationApi.validateToken(token)) as {
        valid?: boolean
        reason?: string
        phoneVerified?: boolean
        verifiedPhone?: string
      }
      if (!mounted) return
      if (res?.valid) {
        if (res.phoneVerified && res.verifiedPhone) {
          setVerifiedPhone(res.verifiedPhone)
          setGatePhone(res.verifiedPhone)
          setPhase('form')
        } else {
          setPhase('gate')
        }
      } else {
        setInvalidReason(res?.reason || 'error')
        setPhase('invalid')
      }
    })()
    registrationApi.getTitles().then((r) => {
      if (mounted && r.success && Array.isArray(r.data)) setTitles(r.data)
    })
    registrationApi.getDepartments().then((r) => {
      if (mounted && r.success && Array.isArray(r.data)) setDepartments(r.data)
    })
    return () => {
      mounted = false
    }
  }, [token])

  // ── Gate handlers ──────────────────────────────────────────────────────────

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!gatePhone.trim()) return setError('Enter your phone number.')
    setBusy(true)
    const res = await registrationApi.sendOtp(token, gatePhone.trim())
    setBusy(false)
    if (res.success) {
      setOtpSent(true)
      setDevCode(typeof res.devCode === 'string' ? res.devCode : null)
    } else {
      setError(res.error || 'Could not send the code. Please try again.')
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(otp.trim())) return setError('Enter the 6-digit code.')
    setBusy(true)
    const res = await registrationApi.verifyOtp(token, gatePhone.trim(), otp.trim())
    setBusy(false)
    if (res.success) {
      const vp = typeof res.verifiedPhone === 'string' ? res.verifiedPhone : gatePhone.trim()
      setVerifiedPhone(vp)
      setPhase('form')
    } else {
      setError(res.error || 'Incorrect code.')
    }
  }

  // ── File handlers ──────────────────────────────────────────────────────────

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Passport photo must be an image.')
    if (file.size > 2 * 1024 * 1024) return setError('Passport photo must be under 2 MB.')
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      setPhotoPreview(url)
      set('profileImage', url)
    }
    reader.readAsDataURL(file)
  }

  async function handleCv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setCvUploading(true)
    const res = await registrationApi.uploadCv(token, file)
    setCvUploading(false)
    if (res.success) {
      setCvName(file.name)
    } else {
      setError(res.error || 'Failed to upload CV.')
    }
  }

  // ── Step navigation ────────────────────────────────────────────────────────

  /** Returns an error message for `target`, or null when it's complete. */
  function validateStep(target: StepId): string | null {
    const missing = REQUIRED_BY_STEP[target]
      .filter(([field]) => !(form[field] ?? '').trim())
      .map(([, label]) => label)
    if (missing.length) return `Please complete: ${missing.join(', ')}`

    // Ghana Card is shape-checked (matching the backend + HR form) — a typo
    // here is caught before submit rather than surfacing as a validation error.
    if (target === 1 && (form.ghanaCardDigits ?? '').length !== GHANA_CARD_DIGITS + 1) {
      return `Ghana Card PIN needs ${GHANA_CARD_DIGITS} digits plus the final check digit.`
    }

    // Bank only, matching the HR form. A half-filled bank set is useless to
    // payroll, so require the complete set.
    if (target === 2) {
      const bankMissing = (
        [
          ['bankName', 'Bank name'],
          ['bankAccountName', 'Account name'],
          ['bankAccountNumber', 'Account number'],
        ] as const
      )
        .filter(([f]) => !(form[f] ?? '').trim())
        .map(([, l]) => l)
      if (bankMissing.length) return `Please complete: ${bankMissing.join(', ')}`
    }

    if (target === LAST_STEP && !consent) {
      return 'Please accept the data-processing consent to submit.'
    }
    return null
  }

  function handleNext() {
    const err = validateStep(step)
    if (err) {
      setError(err)
      scrollToTop()
      return
    }
    setError(null)
    setStep((s) => Math.min(s + 1, LAST_STEP) as StepId)
    scrollToTop()
  }

  function handleBack() {
    setError(null)
    setStep((s) => Math.max(s - 1, 1) as StepId)
    scrollToTop()
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    // Re-check every step, not just the last: a staffer can reach Finish and
    // then go back and clear something.
    for (const s of STEPS) {
      const err = validateStep(s.id)
      if (err) {
        setStep(s.id)
        setError(err)
        scrollToTop()
        return
      }
    }

    const payload: Record<string, unknown> = {
      // Personal
      fullName: form.fullName,
      dateOfBirth: form.dateOfBirth,
      gender: form.gender,
      nationality: form.nationality || 'Ghanaian',
      maritalStatus: form.maritalStatus,
      // Format the digits the same way the HR form does, so both intake paths
      // store a canonical GHA-#########-#.
      ghanaCardPin: formatGhanaCardPin(form.ghanaCardDigits ?? '') ?? '',
      email: form.email || undefined,
      residentialAddress: form.residentialAddress,
      digitalAddress: form.digitalAddress,
      profileImage: form.profileImage || undefined,
      nextOfKinName: form.nextOfKinName,
      nextOfKinRelationship: form.nextOfKinRelationship,
      nextOfKinPhone: form.nextOfKinPhone,
      // Employment — department and date of joining are optional now (HR can
      // fill them at approval); bank only, matching the HR form.
      title: form.title,
      department: form.department || undefined,
      dateOfJoining: form.joinMonth ? `${form.joinMonth}-01` : undefined,
      ssnitId: form.ssnitId || undefined,
      bankName: form.bankName,
      bankAccountName: form.bankAccountName,
      bankAccountNumber: form.bankAccountNumber,
      // Emergency
      emergencyContactName: form.emergencyContactName,
      emergencyContactRelationship: form.emergencyContactRelationship,
      emergencyContactPhone: form.emergencyContactPhone,
      // Consent
      consentGiven: true,
    }

    setBusy(true)
    const res = await registrationApi.submit(token, payload)
    setBusy(false)
    if (res.success) {
      setPhase('submitted')
    } else {
      setError(res.error || 'Could not submit. Please check the form and try again.')
      // `window.scrollTo` was a no-op here: the app shell locks document
      // scrolling, so the error banner this reveals was often never seen.
      scrollToTop()
    }
  }

  const logo = branding.logoHorizontalUrl ?? logoFallback

  // ── Shells ───────────────────────────────────────────────────────────────

  const BrandBar = (
    <div className="flex items-center justify-center border-b border-border bg-card/60 px-4 py-4">
      <img src={logo} alt={branding.name} className="h-8 w-auto object-contain" />
    </div>
  )

  if (phase === 'validating') {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (phase === 'invalid') {
    const copy = INVALID_COPY[invalidReason] ?? INVALID_COPY.error
    return (
      <div className="flex h-full flex-col bg-background">
        {BrandBar}
        <div className="scroll-area min-h-0 flex-1">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-5 py-20 text-center">
            <XCircle className="h-12 w-12 text-muted-foreground/40" />
            <h1 className="text-xl font-bold">{copy.title}</h1>
            <p className="text-sm text-muted-foreground">{copy.body}</p>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'submitted') {
    return (
      <div className="flex h-full flex-col bg-background">
        {BrandBar}
        <div className="scroll-area min-h-0 flex-1">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-5 py-20 text-center">
            <CheckCircle2 className="h-14 w-14 text-primary" />
            <h1 className="text-2xl font-bold">Thank you!</h1>
            <p className="text-sm text-muted-foreground">
              Your registration has been submitted for review. The clinic will approve your account
              shortly, after which you can sign in with your phone number.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'gate') {
    return (
      <div className="flex h-full flex-col bg-background">
        {BrandBar}
        <div className="scroll-area min-h-0 flex-1">
          <div className="mx-auto max-w-md px-5 py-10">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <h1 className="text-xl font-bold">Staff registration</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                First, verify your phone number. This becomes your login.
              </p>
            </div>

            <Card className="rounded-2xl">
              <CardContent className="space-y-4 pt-6">
                {error && (
                  <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}

                {!otpSent ? (
                  <form onSubmit={handleSendOtp} className="space-y-4">
                    <Field label="Phone number" required htmlFor="gate-phone">
                      <Input
                        id="gate-phone"
                        type="tel"
                        inputMode="tel"
                        placeholder="e.g. 024 123 4567"
                        value={gatePhone}
                        onChange={(e) => setGatePhone(e.target.value)}
                        autoFocus
                      />
                    </Field>
                    <Button type="submit" className="w-full" disabled={busy}>
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Send code
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={handleVerifyOtp} className="space-y-4">
                    <Field
                      label="Enter the 6-digit code"
                      required
                      htmlFor="gate-otp"
                      hint={`Sent to ${gatePhone}`}
                    >
                      <Input
                        id="gate-otp"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="000000"
                        className="text-center text-lg tracking-[0.4em]"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                        autoFocus
                      />
                    </Field>
                    {devCode && (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                        Dev code: <span className="font-mono font-bold">{devCode}</span>
                      </p>
                    )}
                    <Button type="submit" className="w-full" disabled={busy}>
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Verify & continue
                    </Button>
                    <button
                      type="button"
                      className="w-full text-center text-xs text-muted-foreground underline"
                      onClick={() => {
                        setOtpSent(false)
                        setOtp('')
                        setError(null)
                      }}
                    >
                      Use a different number
                    </button>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  // ── phase === 'form' ───────────────────────────────────────────────────────
  const payMethod = form.payMethod || 'bank'

  return (
    // h-full, not min-h-screen: #root is height:100% + overflow:hidden (the PWA
    // app shell), so the page must fill that box and scroll INSIDE it.
    <div className="flex h-full flex-col bg-background">
      {BrandBar}

      {/* Step rail — fixed above the scrolling pane so progress stays visible. */}
      <div className="border-b border-border bg-card/60 px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-1.5">
          {STEPS.map((s) => (
            <div key={s.id} className="flex flex-1 flex-col gap-1.5">
              <div
                className={`h-1 rounded-full transition-colors ${
                  s.id <= step ? 'bg-primary' : 'bg-border'
                }`}
              />
              <span
                className={`text-[10px] font-medium ${
                  s.id === step ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        {/* min-h-0 is load-bearing: without it this flex child refuses to
            shrink and the overflow never engages. */}
        <div ref={scrollRef} className="scroll-area min-h-0 flex-1">
          <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight">Staff registration</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Step {step} of {LAST_STEP}. Fields marked{' '}
                <span className="text-destructive">*</span> are required.
              </p>
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* 1 — Personal */}
            {step === 1 && (
              <SectionCard title="1. Personal">
                <Field label="Full legal name" required htmlFor="fullName">
                  <Input
                    id="fullName"
                    value={form.fullName ?? ''}
                    onChange={(e) => set('fullName', e.target.value)}
                  />
                </Field>
                <Field label="Date of birth" required htmlFor="dob">
                  <Input
                    id="dob"
                    type="date"
                    value={form.dateOfBirth ?? ''}
                    onChange={(e) => set('dateOfBirth', e.target.value)}
                  />
                </Field>
                <Field label="Gender" required>
                  <Select value={form.gender ?? ''} onValueChange={(v) => set('gender', v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {GENDER_OPTIONS.map((g) => (
                        <SelectItem key={g.value} value={g.value}>
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Nationality" htmlFor="nationality">
                  <Input
                    id="nationality"
                    value={form.nationality ?? ''}
                    onChange={(e) => set('nationality', e.target.value)}
                  />
                </Field>
                <Field label="Marital status" required>
                  <Select
                    value={form.maritalStatus ?? ''}
                    onValueChange={(v) => set('maritalStatus', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {MARITAL_OPTIONS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Ghana Card PIN"
                  required
                  htmlFor="ghanaCardPin"
                  hint={
                    formatGhanaCardPin(form.ghanaCardDigits ?? '') ??
                    'Enter your digits — the GHA- prefix and dash are added for you.'
                  }
                >
                  {/* The GHA- prefix and dash are structural, so they're chrome
                      rather than something to type. Matches the HR form. */}
                  <div className="flex items-center gap-2">
                    <span className="rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-sm text-muted-foreground">
                      GHA-
                    </span>
                    <Input
                      id="ghanaCardPin"
                      inputMode="numeric"
                      placeholder="123456789 0"
                      className="font-mono"
                      value={form.ghanaCardDigits ?? ''}
                      onChange={(e) =>
                        set(
                          'ghanaCardDigits',
                          e.target.value.replace(/\D/g, '').slice(0, GHANA_CARD_DIGITS + 1)
                        )
                      }
                    />
                  </div>
                </Field>
                <Field label="Phone (login)" hint="Verified — this is your sign-in number.">
                  <div className="flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    {verifiedPhone}
                  </div>
                </Field>
                <Field label="Email (optional)" htmlFor="email">
                  <Input
                    id="email"
                    type="email"
                    value={form.email ?? ''}
                    onChange={(e) => set('email', e.target.value)}
                  />
                </Field>
                <Field label="Residential address" required htmlFor="residentialAddress">
                  <Textarea
                    id="residentialAddress"
                    rows={2}
                    value={form.residentialAddress ?? ''}
                    onChange={(e) => set('residentialAddress', e.target.value)}
                  />
                </Field>
                <Field
                  label="Digital address (GhanaPost GPS)"
                  required
                  htmlFor="digitalAddress"
                  hint="e.g. GA-123-4567"
                >
                  <Input
                    id="digitalAddress"
                    value={form.digitalAddress ?? ''}
                    onChange={(e) => set('digitalAddress', e.target.value)}
                  />
                </Field>

                {/* Passport photo (optional) */}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-sm">Passport photo (optional)</Label>
                  <div className="flex items-center gap-3">
                    {photoPreview ? (
                      <img
                        src={photoPreview}
                        alt="Preview"
                        className="h-14 w-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                        Photo
                      </div>
                    )}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhoto}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => photoInputRef.current?.click()}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {photoPreview ? 'Change' : 'Upload'}
                    </Button>
                  </div>
                </div>

                {/* Next of kin */}
                <div className="sm:col-span-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Next of kin
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Name" required htmlFor="nokName">
                      <Input
                        id="nokName"
                        value={form.nextOfKinName ?? ''}
                        onChange={(e) => set('nextOfKinName', e.target.value)}
                      />
                    </Field>
                    <Field label="Relationship" required htmlFor="nokRel">
                      <Input
                        id="nokRel"
                        value={form.nextOfKinRelationship ?? ''}
                        onChange={(e) => set('nextOfKinRelationship', e.target.value)}
                      />
                    </Field>
                    <Field label="Phone" required htmlFor="nokPhone">
                      <Input
                        id="nokPhone"
                        type="tel"
                        value={form.nextOfKinPhone ?? ''}
                        onChange={(e) => set('nextOfKinPhone', e.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* 2 — Employment */}
            {step === 2 && (
              <SectionCard title="2. Employment">
                <Field label="Title / clinical position" required>
                  <Select value={form.title ?? ''} onValueChange={(v) => set('title', v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {titles.map((t) => (
                        <SelectItem key={t.id} value={t.displayName}>
                          {t.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Department" hint="Optional — the clinic can set this.">
                  <Select value={form.department ?? ''} onValueChange={(v) => set('department', v)}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={departments.length ? 'Select…' : 'None available'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.name}>
                          {d.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Date of joining (optional)"
                  htmlFor="joinMonth"
                  hint="Month and year."
                >
                  <Input
                    id="joinMonth"
                    type="month"
                    value={form.joinMonth ?? ''}
                    onChange={(e) => set('joinMonth', e.target.value)}
                  />
                </Field>
                <Field label="SSNIT number (optional)" htmlFor="ssnitId">
                  <Input
                    id="ssnitId"
                    value={form.ssnitId ?? ''}
                    onChange={(e) => set('ssnitId', e.target.value)}
                  />
                </Field>

                {/* Payment — bank only. Staff are paid by transfer; mobile money
                    was removed from both intake paths. */}
                <div className="sm:col-span-2">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Bank account
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Bank name" required htmlFor="bankName">
                      <Input
                        id="bankName"
                        value={form.bankName ?? ''}
                        onChange={(e) => set('bankName', e.target.value)}
                      />
                    </Field>
                    <Field label="Account name" required htmlFor="bankAccountName">
                      <Input
                        id="bankAccountName"
                        value={form.bankAccountName ?? ''}
                        onChange={(e) => set('bankAccountName', e.target.value)}
                      />
                    </Field>
                    <Field label="Account number" required htmlFor="bankAccountNumber">
                      <Input
                        id="bankAccountNumber"
                        value={form.bankAccountNumber ?? ''}
                        onChange={(e) => set('bankAccountNumber', e.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Education step dropped — it's on the CV the registrant uploads,
                so re-typing it here was duplicate data entry (matches the HR
                form). Steps renumbered: Emergency is now 3, Finish is 4. */}

            {/* 3 — Emergency info */}
            {step === 3 && (
              <SectionCard title="3. Emergency contact">
                <Field label="Contact name" required htmlFor="emgName">
                  <Input
                    id="emgName"
                    value={form.emergencyContactName ?? ''}
                    onChange={(e) => set('emergencyContactName', e.target.value)}
                  />
                </Field>
                <Field label="Relationship" required htmlFor="emgRel">
                  <Input
                    id="emgRel"
                    value={form.emergencyContactRelationship ?? ''}
                    onChange={(e) => set('emergencyContactRelationship', e.target.value)}
                  />
                </Field>
                <Field label="Phone" required htmlFor="emgPhone">
                  <Input
                    id="emgPhone"
                    type="tel"
                    value={form.emergencyContactPhone ?? ''}
                    onChange={(e) => set('emergencyContactPhone', e.target.value)}
                  />
                </Field>
              </SectionCard>
            )}

            {/* 4 — CV + consent */}
            {step === LAST_STEP && (
              <Card className="rounded-2xl">
                <CardContent className="space-y-5 pt-6">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Upload CV (optional)</Label>
                    <div className="flex items-center gap-3">
                      <input
                        ref={cvInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,image/*"
                        className="hidden"
                        onChange={handleCv}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={cvUploading}
                        onClick={() => cvInputRef.current?.click()}
                      >
                        {cvUploading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="mr-2 h-4 w-4" />
                        )}
                        {cvName ? 'Replace CV' : 'Choose file'}
                      </Button>
                      {cvName && (
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                          {cvName}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      PDF, Word doc, or image (max 8 MB).
                    </p>
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-muted/40 p-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {CONSENT_TEXT}
                    </span>
                  </label>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Fixed footer — outside the scroll pane, so Next is always reachable
            no matter how long the step is. */}
        <div className="border-t border-border bg-card px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            {step > 1 && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={handleBack}
                disabled={busy}
                className="flex-1"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            )}
            {step < LAST_STEP ? (
              <Button type="button" size="lg" onClick={handleNext} className="flex-[2]">
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={busy || !consent} className="flex-[2]">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit registration
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
