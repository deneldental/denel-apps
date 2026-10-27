import {
  formatGhanaCardPin,
  GENDERS,
  type Gender,
  GHANA_CARD_DIGITS,
  MARITAL_STATUSES,
  type MaritalStatus,
} from '@denel/types'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Input,
  Label,
  PasswordInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Textarea,
} from '@denel/ui'
import { cn } from '@denel/utils'
import { ArrowLeft, KeyRound, ShieldCheck, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { type WizardRole, wizardRoleOptions } from '@/features/staff/role-access'
import {
  type EmploymentTypeRow,
  type LookupRow,
  listEmploymentTypes,
  listHrDepartments,
  listStaffTitles,
} from '@/lib/actions/lookups'
import { onboardedSignIns } from '@/lib/roles'
import { AvatarCropperDialog } from '@/shared/components/avatar-cropper-dialog'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useCanAssignAnyRole } from '@/shared/hooks/use-role-authority'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'

/**
 * Add Staff — 5-step wizard. CREATE ONLY, and INTERNAL STAFF ONLY.
 *
 * Editing lives on the staff profile (Identity / Personal / Employment /
 * Access / Compensation sheets). This sheet used to double as an editor but
 * never hydrated employment/personal fields, so saving wiped them — one owner
 * per concern: the wizard creates, the profile edits.
 *
 * Scope: internal staff. Doctors, specialists and external trainers are
 * onboarded through their own flow (they need specialist records, commission
 * rates, withholding tax) — none of which belongs here. That's why there is no
 * staff-type switch: everyone created here is internal.
 *
 * Position, department and employment type are ADMIN-MANAGED LOOKUPS (migration
 * 0178), fetched live. HR adds a new type in Settings and it appears here
 * without a deploy.
 *
 * See project-docs/staff-personal-data-build-plan.md.
 */

// ── Form shape ───────────────────────────────────────────────────────────────
//
// ONE object rather than ~40 useState calls: the old wizard hand-listed every
// field four times (state, draft interface, draft read/write, isDirty), which
// is the same hand-maintained-list pattern that let fields be collected and
// never saved. Adding a field here + in INITIAL_FORM is enough.

interface WizardForm {
  // Step 1 — Identity
  name: string
  email: string
  phone: string
  avatarUrl: string | null
  isActive: boolean
  dateOfBirth: string
  gender: string
  nationality: string
  maritalStatus: string
  /** Digits only. Formatted to GHA-#########-# on submit. */
  ghanaCardDigits: string

  // Step 2 — Contact & emergency
  residentialAddress: string
  digitalAddress: string
  emergencyContactName: string
  emergencyContactRelationship: string
  emergencyContactPhone: string
  nextOfKinName: string
  nextOfKinRelationship: string
  nextOfKinPhone: string

  // Step 3 — Employment (all three are lookup slugs)
  position: string
  department: string
  employmentType: string
  dateOfJoining: string
  probationEndDate: string
  /** Only meaningful for fixed-term staff — see the employment type's `kind`. */
  contractEndDate: string
  ssnitId: string

  // Step 4 — Pay. Bank only: staff are paid by transfer.
  bankName: string
  bankAccountName: string
  bankAccountNumber: string

  // Step 5 — Access
  initialPassword: string
  forcePasswordChange: boolean
  /** The RBAC role — required. It decides what they can do and where they sign in. */
  systemRole: string
  positionTag: 'staff' | 'non_staff'
  hasPayslip: boolean
  tracksAttendance: boolean
  requiresLicense: boolean
}

const UNSET = '__unset__'

const INITIAL_FORM: WizardForm = {
  name: '',
  email: '',
  phone: '',
  avatarUrl: null,
  isActive: true,
  dateOfBirth: '',
  gender: UNSET,
  nationality: 'Ghanaian',
  maritalStatus: UNSET,
  ghanaCardDigits: '',

  residentialAddress: '',
  digitalAddress: '',
  emergencyContactName: '',
  emergencyContactRelationship: '',
  emergencyContactPhone: '',
  nextOfKinName: '',
  nextOfKinRelationship: '',
  nextOfKinPhone: '',

  position: UNSET,
  department: UNSET,
  employmentType: '',
  dateOfJoining: '',
  probationEndDate: '',
  contractEndDate: '',
  ssnitId: '',

  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',

  initialPassword: '',
  forcePasswordChange: true,
  systemRole: UNSET,
  positionTag: 'staff',
  hasPayslip: true,
  tracksAttendance: true,
  requiresLicense: false,
}

// ── Payload ──────────────────────────────────────────────────────────────────

/**
 * What the parent persists. Field names match the POST /api/staff contract
 * (validated against createStaffSchema in @denel/types) — except `name`, a
 * legacy quirk of that endpoint.
 */
export interface TeamMemberFormPayload {
  name: string
  email: string
  phone: string | null
  avatarUrl: string | null
  isActive: boolean
  initialPassword?: string
  forcePasswordChange?: boolean

  // Biographical
  dateOfBirth: string | null
  gender: Gender | null
  nationality: string | null
  maritalStatus: MaritalStatus | null
  ghanaCardPin: string | null

  // Contact + emergency + next of kin
  residentialAddress: string | null
  digitalAddress: string | null
  emergencyContactName: string | null
  emergencyContactRelationship: string | null
  emergencyContactPhone: string | null
  nextOfKinName: string | null
  nextOfKinRelationship: string | null
  nextOfKinPhone: string | null

  // Employment
  position: string | null
  department: string | null
  employmentType: string
  dateOfJoining: string | null
  probationEndDate: string | null
  contractEndDate: string | null
  ssnitId: string | null

  // Payout — bank only
  bankName: string | null
  bankAccountName: string | null
  bankAccountNumber: string | null

  /**
   * The RBAC role picked on the Access step. Where they can sign in follows
   * from it; the Team app is granted to everyone onboarded here.
   */
  initialRole: string
  positionTag: 'staff' | 'non_staff'
  hasPayslip: boolean
  tracksAttendance: boolean
  requiresLicense: boolean
}

interface TeamMemberSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Parent owns persistence. Awaited, so backend errors surface in the wizard. */
  onSave: (data: TeamMemberFormPayload) => Promise<void> | void
}

// ── Labels ───────────────────────────────────────────────────────────────────

const GENDER_LABELS: Record<Gender, string> = { male: 'Male', female: 'Female' }
const MARITAL_LABELS: Record<MaritalStatus, string> = {
  single: 'Single',
  married: 'Married',
  divorced: 'Divorced',
  widowed: 'Widowed',
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]?.charAt(0).toUpperCase()
  return (parts[0]?.charAt(0) + parts[parts.length - 1]?.charAt(0)).toUpperCase()
}

// ── Draft persistence ────────────────────────────────────────────────────────
// HR loses everything if they dismiss the wizard mid-flow. Persist on every
// keystroke, restore on next open, discard after 24h. The password is NEVER
// persisted — HR re-enters it before saving.

const DRAFT_KEY = 'denel:hr:staff-wizard:draft'
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

type StaffDraft = Omit<WizardForm, 'initialPassword'> & { timestamp: number }

function readStaffDraft(): StaffDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StaffDraft
    if (!parsed || typeof parsed.timestamp !== 'number') return null
    if (Date.now() - parsed.timestamp > DRAFT_TTL_MS) {
      window.localStorage.removeItem(DRAFT_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeStaffDraft(form: WizardForm): void {
  if (typeof window === 'undefined') return
  try {
    const { initialPassword: _omit, ...rest } = form
    const draft: StaffDraft = {
      ...rest,
      // Never persist data: URLs — they can exhaust the 5 MB localStorage quota.
      avatarUrl: form.avatarUrl?.startsWith('data:') ? null : form.avatarUrl,
      timestamp: Date.now(),
    }
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Best-effort — ignore quota / private-mode failures.
  }
}

/**
 * Keep only fields the form still has — a draft saved before a field was
 * renamed or removed (portalAccess / portalRole → systemRole) must not carry
 * stale keys back into the form.
 */
function knownDraftFields(draft: Record<string, unknown>): Partial<WizardForm> {
  const known: Record<string, unknown> = {}
  for (const key of Object.keys(INITIAL_FORM)) {
    if (key in draft) known[key] = draft[key]
  }
  return known as Partial<WizardForm>
}

function clearStaffDraft(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Ignore.
  }
}

// ── Steps ────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 1, label: 'Identity' },
  { id: 2, label: 'Contact' },
  { id: 3, label: 'Employment' },
  { id: 4, label: 'Pay' },
  { id: 5, label: 'Access' },
]

const LAST_STEP: Step = 5

/** Trim to null — the API treats '' as "not provided" and null as "clear". */
const nn = (v: string): string | null => (v.trim() ? v.trim() : null)
/** Radix sentinel to null. */
const sel = <T extends string>(v: string): T | null => (v === UNSET ? null : (v as T))

export function TeamMemberSheet({ open, onOpenChange, onSave }: TeamMemberSheetProps) {
  const [form, setForm] = useState<WizardForm>(INITIAL_FORM)
  const [step, setStep] = useState<Step>(1)
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()
  const [draftRestored, setDraftRestored] = useState(false)

  // Admin-managed lookups (0178). Fetched on open so a type HR added five
  // minutes ago is already here.
  const [titles, setTitles] = useState<LookupRow[]>([])
  const [departments, setDepartments] = useState<LookupRow[]>([])
  const [employmentTypes, setEmploymentTypes] = useState<EmploymentTypeRow[]>([])
  const [lookupsLoading, setLookupsLoading] = useState(true)

  function set<K extends keyof WizardForm>(key: K, value: WizardForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    if (!open) return
    setStep(1)
    setStatusMessage(undefined)
    const draft = readStaffDraft()
    if (draft) {
      const { timestamp: _t, ...rest } = draft
      setForm({ ...INITIAL_FORM, ...knownDraftFields(rest), initialPassword: '' })
      setDraftRestored(true)
    } else {
      setForm(INITIAL_FORM)
      setDraftRestored(false)
    }

    setLookupsLoading(true)
    void Promise.all([listStaffTitles(), listHrDepartments(), listEmploymentTypes()]).then(
      ([t, d, e]) => {
        if (t.success && t.data) setTitles(t.data)
        if (d.success && d.data) setDepartments(d.data)
        if (e.success && e.data) setEmploymentTypes(e.data)
        setLookupsLoading(false)
      }
    )
  }, [open])

  useEffect(() => {
    if (!open) return
    writeStaffDraft(form)
  }, [open, form])

  // Default the employment type to the first available once loaded, rather than
  // hard-coding 'permanent' — the admin owns this list and could rename or
  // deactivate it.
  const _employmentTypesKey = employmentTypes.map((t) => t.name).join(',')
  useEffect(() => {
    if (!employmentTypes.length) return
    setForm((prev) =>
      prev.employmentType && employmentTypes.some((t) => t.name === prev.employmentType)
        ? prev
        : { ...prev, employmentType: employmentTypes[0].name }
    )
  }, [employmentTypes])

  /** The selected type's behaviour class — what drives the contract end date. */
  const selectedEmployment = employmentTypes.find((t) => t.name === form.employmentType)
  const isFixedTerm = selectedEmployment?.kind === 'contract'

  // A permanent role has no contract end date. Clear any date carried over from
  // a fixed-term selection so a stale value can't be submitted invisibly.
  useEffect(() => {
    if (!isFixedTerm && form.contractEndDate) {
      setForm((prev) => ({ ...prev, contractEndDate: '' }))
    }
  }, [isFixedTerm, form.contractEndDate])

  const isDirty = useMemo(
    () =>
      (Object.keys(INITIAL_FORM) as Array<keyof WizardForm>).some(
        (k) => form[k] !== INITIAL_FORM[k]
      ),
    [form]
  )

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => onOpenChange(false),
  })

  const [cropperSource, setCropperSource] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Offer only the roles this person may actually give (D15). The server refuses the rest.
  const canAssignAnyRole = useCanAssignAnyRole()
  const roleOptions = useMemo(() => wizardRoleOptions(canAssignAnyRole), [canAssignAnyRole])

  // ── Validation ──────────────────────────────────────────────────────────
  //
  // Required stays deliberately minimal: name, email, password. HR must be able
  // to create a record quickly — date of joining is optional on purpose so it
  // can be filled in later. Everything else is optional-but-visible.
  function validateStep(target: Step): { error: string; step: Step } | null {
    if (target >= 1) {
      if (!form.name.trim()) return { error: 'Please enter the staff member name.', step: 1 }
      if (!form.email.trim()) return { error: 'Please enter an email.', step: 1 }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
        return { error: 'Email looks invalid.', step: 1 }
      if (form.dateOfBirth && Number.isNaN(new Date(form.dateOfBirth).getTime()))
        return { error: 'Date of birth is not a valid date.', step: 1 }
      // Shape only — we never claim to know whether a PIN is genuine.
      if (form.ghanaCardDigits && form.ghanaCardDigits.length !== GHANA_CARD_DIGITS + 1)
        return {
          error: `Ghana Card PIN needs ${GHANA_CARD_DIGITS} digits plus the final check digit.`,
          step: 1,
        }
    }
    if (target >= 3) {
      for (const [field, label] of [
        ['dateOfJoining', 'Date of joining'],
        ['probationEndDate', 'Probation end date'],
        ['contractEndDate', 'Contract end date'],
      ] as const) {
        const v = form[field]
        if (v && Number.isNaN(new Date(v).getTime()))
          return { error: `${label} is not a valid date.`, step: 3 }
      }
      if (!form.employmentType) return { error: 'Pick an employment type.', step: 3 }
    }
    if (target >= LAST_STEP) {
      if (form.initialPassword.trim().length < 10)
        return { error: 'Initial password must be at least 10 characters.', step: 5 }
      if (form.systemRole === UNSET)
        return {
          error: 'Pick a system role. It decides what they can do and where they can sign in.',
          step: 5,
        }
    }
    return null
  }

  function handleNext() {
    const err = validateStep(step)
    if (err) {
      setStep(err.step)
      toast.error(err.error)
      return
    }
    if (step < LAST_STEP) setStep((step + 1) as Step)
    else void handleSubmit()
  }

  function handleBack() {
    if (step > 1) setStep((step - 1) as Step)
  }

  async function handleSubmit() {
    await submit(async () => {
      const err = validateStep(LAST_STEP)
      if (err) {
        setStep(err.step)
        toast.error(err.error)
        return
      }
      setStatusMessage(undefined)
      try {
        await onSave({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: nn(form.phone),
          avatarUrl: form.avatarUrl,
          isActive: form.isActive,
          initialPassword: nn(form.initialPassword) ?? undefined,
          forcePasswordChange: form.forcePasswordChange,

          // birthDay/birthMonth are DERIVED server-side from dateOfBirth —
          // never sent, or the two could disagree.
          dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : null,
          gender: sel<Gender>(form.gender),
          nationality: nn(form.nationality),
          maritalStatus: sel<MaritalStatus>(form.maritalStatus),
          ghanaCardPin: formatGhanaCardPin(form.ghanaCardDigits),

          residentialAddress: nn(form.residentialAddress),
          digitalAddress: nn(form.digitalAddress),
          emergencyContactName: nn(form.emergencyContactName),
          emergencyContactRelationship: nn(form.emergencyContactRelationship),
          emergencyContactPhone: nn(form.emergencyContactPhone),
          nextOfKinName: nn(form.nextOfKinName),
          nextOfKinRelationship: nn(form.nextOfKinRelationship),
          nextOfKinPhone: nn(form.nextOfKinPhone),

          // Position stores the title's display name (how the rest of the app
          // reads it), while department and employment type store slugs.
          position: sel(form.position)
            ? (titles.find((t) => t.name === form.position)?.displayName ?? null)
            : null,
          department: sel(form.department),
          employmentType: form.employmentType,
          dateOfJoining: form.dateOfJoining || null,
          probationEndDate: form.probationEndDate
            ? new Date(form.probationEndDate).toISOString()
            : null,
          // Guaranteed empty for non-fixed-term by the effect above.
          contractEndDate: form.contractEndDate
            ? new Date(form.contractEndDate).toISOString()
            : null,
          ssnitId: nn(form.ssnitId),

          bankName: nn(form.bankName),
          bankAccountName: nn(form.bankAccountName),
          bankAccountNumber: nn(form.bankAccountNumber),

          // Validated above — never UNSET here.
          initialRole: form.systemRole,
          positionTag: form.positionTag,
          hasPayslip: form.hasPayslip,
          tracksAttendance: form.tracksAttendance,
          requiresLicense: form.requiresLicense,
        })
        clearStaffDraft()
        onOpenChange(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save staff member.'
        setStatusMessage(message)
        toast.error(message)
      }
    })
  }

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Add Staff"
        description="Onboard an internal staff member — identity, contact, employment, pay and access."
        size="lg"
        submitLabel={step < LAST_STEP ? 'Next' : 'Create member'}
        submitting={isSubmitting}
        onSubmit={handleNext}
        statusMessage={statusMessage}
        extraFooter={
          step > 1 ? (
            <Button type="button" variant="ghost" onClick={handleBack} disabled={isSubmitting}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-5">
          <StepRail step={step} onJump={setStep} />

          {draftRestored && step === 1 && (
            <div className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              Restored your unsaved draft. Re-enter the password on the Access step before creating.
            </div>
          )}

          {step === 1 && (
            <IdentityStep
              form={form}
              set={set}
              onAvatarPick={() => fileInputRef.current?.click()}
            />
          )}
          {step === 2 && <ContactStep form={form} set={set} />}
          {step === 3 && (
            <EmploymentStep
              form={form}
              set={set}
              titles={titles}
              departments={departments}
              employmentTypes={employmentTypes}
              loading={lookupsLoading}
              isFixedTerm={isFixedTerm}
            />
          )}
          {step === 4 && <PayStep form={form} set={set} />}
          {step === 5 && <AccessStep form={form} set={set} roleOptions={roleOptions} />}
        </div>
      </SheetFormLayout>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          setCropperSource(file)
          e.target.value = ''
        }}
      />
      <AvatarCropperDialog
        open={!!cropperSource}
        source={cropperSource}
        onOpenChange={(next) => !next && setCropperSource(null)}
        // Uploads to R2 and returns a URL — without this the avatar would be a
        // multi-MB data URL on the create payload.
        uploadConfig={{ kind: 'staff', id: '_new' }}
        onCropped={(_blob, dataUrl, uploadedUrl) => {
          set('avatarUrl', uploadedUrl ?? dataUrl)
          setCropperSource(null)
        }}
      />
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}

// ── Step rail ────────────────────────────────────────────────────────────────

function StepRail({ step, onJump }: { step: Step; onJump: (s: Step) => void }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex flex-1 items-center gap-1">
          <button
            type="button"
            // Backwards only — jumping ahead would skip validation.
            onClick={() => s.id < step && onJump(s.id)}
            disabled={s.id > step}
            className={cn(
              'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              s.id === step && 'bg-primary text-primary-foreground',
              s.id < step && 'bg-muted text-foreground hover:bg-muted/80 cursor-pointer',
              s.id > step && 'text-muted-foreground'
            )}
          >
            {s.label}
          </button>
          {i < STEPS.length - 1 && <div className="h-px w-2 shrink-0 bg-border" />}
        </div>
      ))}
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

type SetFn = <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  type = 'text',
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
  type?: string
  hint?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Select over a fixed vocabulary from @denel/types. */
function EnumField<T extends string>({
  id,
  label,
  value,
  onChange,
  values,
  labels,
  allowUnset = true,
  unsetLabel = 'Not set',
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  values: readonly T[]
  labels: Record<T, string>
  allowUnset?: boolean
  unsetLabel?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={unsetLabel} />
        </SelectTrigger>
        <SelectContent>
          {allowUnset && <SelectItem value={UNSET}>{unsetLabel}</SelectItem>}
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {labels[v]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * Select over an ADMIN-MANAGED lookup. Distinct from EnumField because the
 * options are data, not a vocabulary — including the empty case, which means
 * "an admin hasn't set any of these up yet" and needs saying rather than
 * rendering a mysteriously empty dropdown.
 */
function LookupField({
  id,
  label,
  value,
  onChange,
  rows,
  loading,
  allowUnset = true,
  unsetLabel = 'Not set',
  emptyHint,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  rows: Array<{ name: string; displayName: string | null }>
  loading: boolean
  allowUnset?: boolean
  unsetLabel?: string
  emptyHint: string
  hint?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={loading || rows.length === 0}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={loading ? 'Loading…' : unsetLabel} />
        </SelectTrigger>
        <SelectContent>
          {allowUnset && <SelectItem value={UNSET}>{unsetLabel}</SelectItem>}
          {rows.map((r) => (
            <SelectItem key={r.name} value={r.name}>
              {r.displayName ?? r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!loading && rows.length === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{emptyHint}</p>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

// ── Step 1 — Identity ────────────────────────────────────────────────────────

function IdentityStep({
  form,
  set,
  onAvatarPick,
}: {
  form: WizardForm
  set: SetFn
  onAvatarPick: () => void
}) {
  const pinPreview = formatGhanaCardPin(form.ghanaCardDigits)
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          {form.avatarUrl && <AvatarImage src={form.avatarUrl} alt="" />}
          <AvatarFallback>{getInitials(form.name)}</AvatarFallback>
        </Avatar>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={onAvatarPick}>
            <Upload className="mr-2 h-3.5 w-3.5" />
            {form.avatarUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">PNG or JPG, up to 2 MB.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <TextField
          id="tm-name"
          label="Full name *"
          value={form.name}
          onChange={(v) => set('name', v)}
          maxLength={200}
        />
        <TextField
          id="tm-email"
          label="Email *"
          type="email"
          value={form.email}
          onChange={(v) => set('email', v)}
        />
        <TextField
          id="tm-phone"
          label="Phone"
          type="tel"
          placeholder="+233 XX XXX XXXX"
          value={form.phone}
          onChange={(v) => set('phone', v)}
          hint="Used for the staff app's phone + OTP sign-in."
        />
      </div>

      <Separator />
      <SectionHeading>Biographical</SectionHeading>
      <div className="grid grid-cols-2 gap-4">
        <TextField
          id="tm-dob"
          label="Date of birth"
          type="date"
          value={form.dateOfBirth}
          onChange={(v) => set('dateOfBirth', v)}
          hint="Drives the birthday reminder; the year is used for statutory age checks."
        />
        <EnumField
          id="tm-gender"
          label="Gender"
          value={form.gender}
          onChange={(v) => set('gender', v)}
          values={GENDERS}
          labels={GENDER_LABELS}
        />
        <TextField
          id="tm-nationality"
          label="Nationality"
          value={form.nationality}
          onChange={(v) => set('nationality', v)}
          maxLength={100}
        />
        <EnumField
          id="tm-marital"
          label="Marital status"
          value={form.maritalStatus}
          onChange={(v) => set('maritalStatus', v)}
          values={MARITAL_STATUSES}
          labels={MARITAL_LABELS}
        />

        {/* The GHA- prefix and the hyphen are structural, so they're chrome
            rather than something to retype on every entry. */}
        <div className="space-y-2">
          <Label htmlFor="tm-ghana-card">Ghana Card PIN</Label>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-sm text-muted-foreground">
              GHA-
            </span>
            <Input
              id="tm-ghana-card"
              inputMode="numeric"
              placeholder="123456789 0"
              className="font-mono"
              value={form.ghanaCardDigits}
              onChange={(e) =>
                set(
                  'ghanaCardDigits',
                  e.target.value.replace(/\D/g, '').slice(0, GHANA_CARD_DIGITS + 1)
                )
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {pinPreview ? (
              <span className="font-mono">{pinPreview}</span>
            ) : (
              `Digits only — ${GHANA_CARD_DIGITS} digits plus the final check digit.`
            )}
          </p>
        </div>
      </div>

      <ToggleRow
        label="Active"
        hint="Inactive staff can't sign in."
        checked={form.isActive}
        onChange={(v) => set('isActive', v)}
      />
    </div>
  )
}

// ── Step 2 — Contact & emergency ─────────────────────────────────────────────

function ContactStep({ form, set }: { form: WizardForm; set: SetFn }) {
  return (
    <div className="grid gap-5">
      <SectionHeading>Address</SectionHeading>
      <div className="space-y-2">
        <Label htmlFor="tm-residential">Residential address</Label>
        <Textarea
          id="tm-residential"
          rows={2}
          maxLength={500}
          value={form.residentialAddress}
          onChange={(e) => set('residentialAddress', e.target.value)}
        />
      </div>
      <TextField
        id="tm-digital-address"
        label="Digital address"
        placeholder="GhanaPost GPS, e.g. GA-123-4567"
        value={form.digitalAddress}
        onChange={(v) => set('digitalAddress', v)}
        maxLength={30}
      />

      <Separator />
      <SectionHeading>Emergency contact</SectionHeading>
      <div className="grid grid-cols-3 gap-4">
        <TextField
          id="tm-ec-name"
          label="Name"
          value={form.emergencyContactName}
          onChange={(v) => set('emergencyContactName', v)}
          maxLength={200}
        />
        <TextField
          id="tm-ec-rel"
          label="Relationship"
          placeholder="e.g. Sister"
          value={form.emergencyContactRelationship}
          onChange={(v) => set('emergencyContactRelationship', v)}
          maxLength={50}
        />
        <TextField
          id="tm-ec-phone"
          label="Phone"
          type="tel"
          value={form.emergencyContactPhone}
          onChange={(v) => set('emergencyContactPhone', v)}
          maxLength={30}
        />
      </div>

      <SectionHeading>Next of kin</SectionHeading>
      <div className="grid grid-cols-3 gap-4">
        <TextField
          id="tm-nok-name"
          label="Name"
          value={form.nextOfKinName}
          onChange={(v) => set('nextOfKinName', v)}
          maxLength={200}
        />
        <TextField
          id="tm-nok-rel"
          label="Relationship"
          placeholder="e.g. Father"
          value={form.nextOfKinRelationship}
          onChange={(v) => set('nextOfKinRelationship', v)}
          maxLength={50}
        />
        <TextField
          id="tm-nok-phone"
          label="Phone"
          type="tel"
          value={form.nextOfKinPhone}
          onChange={(v) => set('nextOfKinPhone', v)}
          maxLength={30}
        />
      </div>
    </div>
  )
}

// ── Step 3 — Employment ──────────────────────────────────────────────────────

function EmploymentStep({
  form,
  set,
  titles,
  departments,
  employmentTypes,
  loading,
  isFixedTerm,
}: {
  form: WizardForm
  set: SetFn
  titles: LookupRow[]
  departments: LookupRow[]
  employmentTypes: EmploymentTypeRow[]
  loading: boolean
  isFixedTerm: boolean
}) {
  return (
    <div className="grid gap-5">
      <SectionHeading>Position</SectionHeading>
      <div className="grid grid-cols-2 gap-4">
        <LookupField
          id="tm-position"
          label="Position"
          value={form.position}
          onChange={(v) => set('position', v)}
          rows={titles}
          loading={loading}
          emptyHint="No positions set up yet — add them in Settings → Titles."
        />
        <LookupField
          id="tm-department"
          label="Department"
          value={form.department}
          onChange={(v) => set('department', v)}
          rows={departments}
          loading={loading}
          emptyHint="No departments set up yet — add them in Settings → Departments."
        />
        <LookupField
          id="tm-emp-type"
          label="Employment type *"
          value={form.employmentType}
          onChange={(v) => set('employmentType', v)}
          rows={employmentTypes}
          loading={loading}
          allowUnset={false}
          emptyHint="No employment types set up yet — add them in Settings → Employment types."
        />
        <TextField
          id="tm-ssnit"
          label="SSNIT ID"
          value={form.ssnitId}
          onChange={(v) => set('ssnitId', v)}
          maxLength={20}
        />
      </div>

      <SectionHeading>Dates</SectionHeading>
      <div className="grid grid-cols-3 gap-4">
        <TextField
          id="tm-date-joined"
          label="Date of joining"
          type="date"
          value={form.dateOfJoining}
          onChange={(v) => set('dateOfJoining', v)}
          hint="Optional — can be set later."
        />
        <TextField
          id="tm-probation-end"
          label="Probation ends"
          type="date"
          value={form.probationEndDate}
          onChange={(v) => set('probationEndDate', v)}
        />
        {/* Only fixed-term roles have an end date. Driven by the employment
            type's `kind`, so an admin-added type like "Locum (6 months)" gets
            this automatically without a code change. */}
        {isFixedTerm && (
          <TextField
            id="tm-contract-end"
            label="Contract ends"
            type="date"
            value={form.contractEndDate}
            onChange={(v) => set('contractEndDate', v)}
            hint="Fixed-term role."
          />
        )}
      </div>
    </div>
  )
}

// ── Step 4 — Pay ─────────────────────────────────────────────────────────────

function PayStep({ form, set }: { form: WizardForm; set: SetFn }) {
  return (
    <div className="grid gap-5">
      <SectionHeading>Bank account</SectionHeading>
      <p className="-mt-3 text-xs text-muted-foreground">Staff are paid by bank transfer.</p>
      <div className="grid grid-cols-2 gap-4">
        <TextField
          id="tm-bank-name"
          label="Bank name"
          value={form.bankName}
          onChange={(v) => set('bankName', v)}
          maxLength={100}
        />
        <TextField
          id="tm-bank-account-name"
          label="Account name"
          value={form.bankAccountName}
          onChange={(v) => set('bankAccountName', v)}
          maxLength={200}
        />
        <TextField
          id="tm-bank-account-number"
          label="Account number"
          value={form.bankAccountNumber}
          onChange={(v) => set('bankAccountNumber', v)}
          maxLength={50}
        />
      </div>
    </div>
  )
}

// ── Step 5 — Access ──────────────────────────────────────────────────────────

function AccessStep({
  form,
  set,
  roleOptions,
}: {
  form: WizardForm
  set: SetFn
  roleOptions: readonly WizardRole[]
}) {
  const selectedRole = roleOptions.find((r) => r.value === form.systemRole)
  return (
    <div className="grid gap-5">
      <div className="space-y-2">
        <Label htmlFor="tm-password">Initial password *</Label>
        <PasswordInput
          id="tm-password"
          value={form.initialPassword}
          onChange={(e) => set('initialPassword', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      </div>

      <ToggleRow
        label="Require password change on first login"
        checked={form.forcePasswordChange}
        onChange={(v) => set('forcePasswordChange', v)}
      />

      <Separator />
      <SectionHeading>System role</SectionHeading>
      <div className="space-y-2">
        <Label htmlFor="tm-system-role">System role *</Label>
        <Select value={form.systemRole} onValueChange={(v) => set('systemRole', v)}>
          <SelectTrigger id="tm-system-role">
            <SelectValue placeholder="Pick a role" />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedRole ? (
          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            <p className="text-muted-foreground">{selectedRole.hint}</p>
            <p className="mt-1.5 flex items-center gap-1.5 font-medium">
              <ShieldCheck className="h-3.5 w-3.5" />
              Signs in to: {onboardedSignIns(selectedRole.value).join(' · ')}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Decides what they can do and where they can sign in. The job title does not. Doctors and
            specialists are onboarded through their own flow, not here.
          </p>
        )}
      </div>

      <Separator />
      <SectionHeading>Capabilities</SectionHeading>
      <div className="grid gap-2">
        <ToggleRow
          label="On payslip"
          checked={form.hasPayslip}
          onChange={(v) => set('hasPayslip', v)}
        />
        <ToggleRow
          label="Tracks attendance"
          hint="Their reader ID is assigned later, from the profile."
          checked={form.tracksAttendance}
          onChange={(v) => set('tracksAttendance', v)}
        />
        <ToggleRow
          label="Requires license"
          hint="Drives credential-expiry alerts."
          checked={form.requiresLicense}
          onChange={(v) => set('requiresLicense', v)}
        />
      </div>

      <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          The password is never saved to your draft — if you leave and come back, re-enter it here.
        </span>
      </div>
    </div>
  )
}
