import { isValidPhoneNumber } from 'libphonenumber-js/max'
import { Plus, User } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import 'react-phone-number-input/style.css'
import PhoneInput from 'react-phone-number-input'
// Bundled flag components. Without this the library fetches every flag from
// purecatamphetamine.github.io at runtime — an external dependency we do not
// want in the clinic's network path.
import flags from 'react-phone-number-input/flags'
import { TagPicker } from '@/features/patients/components/tag-picker'
import { isValidEmail } from '@/features/patients/lib/email-format'
import { PATIENT_GENDERS } from '@/features/patients/lib/patient-genders'
import { toE164Phone, toStoredPhone } from '@/features/patients/lib/phone-format'
import type { Patient } from '@/features/patients/types/patient'
import { findTagBySystemKey, type PatientTag } from '@/lib/actions/patient-tags'
import { updatePatient } from '@/lib/actions/patients'
import { useApiMutation } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import AvatarUpload from '@/shared/components/ui/avatar-upload'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Separator } from '@/shared/components/ui/separator'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useInsuranceCompanies } from '@/shared/hooks/use-insurance-companies'
import { useSeedOnOpen } from '@/shared/hooks/use-seed-on-open'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { apiErrorMessage } from '@/shared/lib/api-error'
import { localDateISO, parseLocalDate } from '@/shared/lib/dates'
import { isSameStoredFileValue } from '@/shared/lib/file-name'

/** Same option set the creation wizard offers (add-patient-sheet.tsx). */
const HOW_DID_YOU_HEAR = [
  { value: 'friend_family', label: 'Friend / Family' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'google', label: 'Google Search' },
  { value: 'other', label: 'Others' },
]

interface EditPatientSheetProps {
  patient: any
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
  onCreated?: () => void
}

function toDobInput(dob: Patient['dob']): string {
  if (!dob) return ''
  // patient.dob is typed as Date but arrives as an ISO string over the wire;
  // pass through new Date() to normalise both forms before localDateISO.
  return localDateISO(new Date(dob as unknown as string))
}

/**
 * Edit-patient form as a right-side Sheet. Migrated from `edit-patient-dialog.tsx`
 * per the UX restructure plan Part 3.
 *
 * Uses the shared `<SheetFormLayout>` (sticky footer, size preset, submission lock)
 * and `useFormDirtyGuard()` so accidental close attempts on a dirty form raise a
 * "Discard unsaved changes?" confirmation.
 */
export function EditPatientSheet({
  patient,
  open,
  onOpenChange,
  onSaved,
  onCreated,
}: EditPatientSheetProps) {
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const [isChild, setIsChild] = useState(patient.isChild || false)
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(
    patient.profileImage || null
  )
  const [name, setName] = useState(patient.name)
  const [dob, setDob] = useState(toDobInput(patient.dob))
  const [gender, setGender] = useState(patient.gender)
  // §2.7 — tags replace the patient-type select; preload the current tag ids.
  const [tagIds, setTagIds] = useState<string[]>(() => (patient.tags ?? []).map((t: any) => t.id))
  const [phone, setPhone] = useState(patient.phone || '')
  const [email, setEmail] = useState(patient.email || '')
  const [address, setAddress] = useState(patient.address || '')
  const [occupation, setOccupation] = useState(patient.occupation || '')
  const [nationality, setNationality] = useState(patient.nationality || 'Ghana')
  const [tagCatalog, setTagCatalog] = useState<PatientTag[]>([])
  const { companies: insuranceCompanies, isLoading: insuranceCompaniesLoading } =
    useInsuranceCompanies(open)
  // Read initial insurance from the patient record, it might be in `patient`?
  // We need to type cast or assume patient has `insuranceProvider` and `insurancePolicyNumber`
  // The Patient type from columns should probably have it.
  const [insuranceProvider, setInsuranceProvider] = useState(
    (patient as any).insuranceProvider || ''
  )
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState(
    (patient as any).insurancePolicyNumber || ''
  )
  const [howDidYouHear, setHowDidYouHear] = useState((patient as any).howDidYouHear || '')
  const [howDidYouHearOther, setHowDidYouHearOther] = useState(
    (patient as any).howDidYouHearOther || ''
  )

  // Bound to systemKey, not the display name: duplicate 'Insurance'/
  // 'insurance' rows used to make this pick an arbitrary one, so ticking the
  // chip did not reliably reveal the provider/policy fields.
  const insuranceTag = findTagBySystemKey(tagCatalog, 'insurance')
  const isInsuranceSelected = insuranceTag ? tagIds.includes(insuranceTag.id) : false

  const [guardianName, setGuardianName] = useState(patient.guardianName || '')
  const [guardianPhone, setGuardianPhone] = useState(patient.guardianPhone || '')
  const [guardianEmail, setGuardianEmail] = useState(patient.guardianEmail || '')
  const [guardianAddress, setGuardianAddress] = useState(patient.guardianAddress || '')
  const [guardianOccupation, setGuardianOccupation] = useState(patient.guardianOccupation || '')

  // Fill the form each time the sheet opens for a patient — not when a refetch
  // hands the same patient back (its photo link is re-signed every 15 min).
  useSeedOnOpen(open, patient.id, () => {
    setIsChild(patient.isChild || false)
    setProfileImageUrl(patient.profileImage || null)
    setName(patient.name)
    setDob(toDobInput(patient.dob))
    setGender(patient.gender)
    setTagIds((patient.tags ?? []).map((t: any) => t.id))
    setPhone(patient.phone || '')
    setEmail(patient.email || '')
    setAddress(patient.address || '')
    setOccupation(patient.occupation || '')
    setNationality(patient.nationality || 'Ghana')
    setGuardianName(patient.guardianName || '')
    setGuardianPhone(patient.guardianPhone || '')
    setGuardianEmail(patient.guardianEmail || '')
    setGuardianAddress(patient.guardianAddress || '')
    setGuardianOccupation(patient.guardianOccupation || '')
    setInsuranceProvider((patient as any).insuranceProvider || '')
    setInsurancePolicyNumber((patient as any).insurancePolicyNumber || '')
    setHowDidYouHear((patient as any).howDidYouHear || '')
    setHowDidYouHearOther((patient as any).howDidYouHearOther || '')
    setStatusMessage(undefined)
  })

  // §2.7 — sorted snapshot of the patient's current tag ids for dirty-checking.
  const initialTagKey = useMemo(
    () =>
      (patient.tags ?? [])
        .map((t: any) => t.id)
        .sort()
        .join(','),
    [patient.tags]
  )

  // Compute dirty state by comparing current inputs against the patient record.
  const isDirty = useMemo(() => {
    return (
      isChild !== (patient.isChild || false) ||
      !isSameStoredFileValue(profileImageUrl, patient.profileImage) ||
      name !== patient.name ||
      dob !== toDobInput(patient.dob) ||
      gender !== patient.gender ||
      [...tagIds].sort().join(',') !== initialTagKey ||
      phone !== (patient.phone || '') ||
      email !== (patient.email || '') ||
      address !== (patient.address || '') ||
      occupation !== (patient.occupation || '') ||
      nationality !== (patient.nationality || 'Ghana') ||
      guardianName !== (patient.guardianName || '') ||
      guardianPhone !== (patient.guardianPhone || '') ||
      guardianEmail !== (patient.guardianEmail || '') ||
      guardianAddress !== (patient.guardianAddress || '') ||
      guardianOccupation !== (patient.guardianOccupation || '') ||
      insuranceProvider !== ((patient as any).insuranceProvider || '') ||
      insurancePolicyNumber !== ((patient as any).insurancePolicyNumber || '') ||
      howDidYouHear !== ((patient as any).howDidYouHear || '') ||
      howDidYouHearOther !== ((patient as any).howDidYouHearOther || '')
    )
  }, [
    patient,
    isChild,
    profileImageUrl,
    name,
    dob,
    gender,
    tagIds,
    initialTagKey,
    phone,
    email,
    address,
    occupation,
    nationality,
    guardianName,
    guardianPhone,
    guardianEmail,
    guardianAddress,
    guardianOccupation,
    insuranceProvider,
    insurancePolicyNumber,
    howDidYouHear,
    howDidYouHearOther,
  ])

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => onOpenChange(false),
  })

  // Pre-empt useApiMutation's generic error so a backend zod issue still
  // surfaces via `apiErrorMessage` (field + message), matching the
  // surfaceApiError() call this replaces.
  const updateMutation = useApiMutation(
    async (vars: Parameters<typeof updatePatient>[1]) => {
      const res = await updatePatient(patient.id, vars)
      if (!res.success) throw new Error(apiErrorMessage(res))
      return res
    },
    { invalidates: [queryKeys.patients.all] }
  )

  // [Medium] Math.abs() used to flip a future DOB's negative time-since-epoch
  // into a plausible-looking positive age instead of flagging the mistake. A
  // future date now returns null (blank preview) instead of a wrong number.
  const calculateAge = (dobString: string) => {
    if (!dobString) return null
    const dobDate = parseLocalDate(dobString)
    const now = new Date()
    const diff = now.getTime() - dobDate.getTime()
    const ageYears = new Date(diff).getUTCFullYear() - 1970
    return ageYears < 0 ? null : ageYears
  }

  async function handleSubmit() {
    setStatusMessage(undefined)

    if (!name || name.trim() === '') {
      toast.error("Please enter the patient's name")
      return
    }

    if (!gender) {
      toast.error('Please select the gender')
      return
    }

    if (!dob) {
      toast.error('Please enter the date of birth')
      return
    }

    if (Number.isNaN(parseLocalDate(dob).getTime())) {
      toast.error('Please enter a valid date of birth')
      return
    }

    if (isInsuranceSelected) {
      if (!insuranceProvider) {
        toast.error('Please select an insurance provider')
        return
      }
      if (!insurancePolicyNumber.trim()) {
        toast.error('Please enter the insurance ID number')
        return
      }
    }

    const phoneToValidate = isChild ? guardianPhone : phone
    if (!phoneToValidate || phoneToValidate.trim() === '') {
      toast.error(
        isChild ? "Please enter the guardian's phone number" : 'Please enter the phone number'
      )
      return
    }

    if (!isValidPhoneNumber(phoneToValidate, 'GH') && !isValidPhoneNumber(phoneToValidate)) {
      toast.error('Please enter a valid phone number')
      return
    }

    const emailToValidate = (isChild ? guardianEmail : email).trim()
    if (emailToValidate && !isValidEmail(emailToValidate)) {
      toast.error(
        isChild
          ? 'Please enter a valid guardian email address'
          : 'Please enter a valid email address'
      )
      return
    }

    interface PatientUpdateInput {
      name: string
      // Typed as Date to match Partial<patients.$inferInsert>; JSON.stringify
      // serialises it to an ISO-8601 string on the wire (correct behaviour).
      dob: Date
      gender: string
      // §2.7 — tags replace the legacy type/isOrtho fields.
      tagIds: string[]
      isChild: boolean
      profileImage: string | null
      nationality: string
      phone?: string | null
      email?: string | null
      address?: string | null
      occupation?: string | null
      guardianName?: string | null
      guardianPhone?: string | null
      guardianEmail?: string | null
      guardianAddress?: string | null
      guardianOccupation?: string | null
      howDidYouHear?: string | null
      howDidYouHearOther?: string | null
    }

    const data: PatientUpdateInput = {
      name,
      dob: parseLocalDate(dob),
      gender,
      tagIds,
      isChild,
      profileImage: profileImageUrl,
      nationality,
      howDidYouHear: howDidYouHear || null,
      // Free-text only belongs to the "other" branch — clearing the radio must
      // clear the note too, or a stale specify-value survives the edit.
      howDidYouHearOther: howDidYouHear === 'other' ? howDidYouHearOther || null : null,
    }

    if (isInsuranceSelected) {
      ;(data as any).insuranceProvider = insuranceProvider
      ;(data as any).insurancePolicyNumber = insurancePolicyNumber
    } else {
      ;(data as any).insuranceProvider = null
      ;(data as any).insurancePolicyNumber = null
    }

    if (isChild) {
      if (!guardianName) {
        toast.error('Guardian name is required')
        return
      }
      data.guardianName = guardianName
      data.guardianPhone = guardianPhone
      data.guardianEmail = guardianEmail.trim() || null
      data.guardianAddress = guardianAddress
      data.guardianOccupation = guardianOccupation
      data.phone = null
      data.email = null
      data.address = null
      data.occupation = null
    } else {
      if (!address) {
        toast.error('Address is required')
        return
      }
      data.phone = phone
      data.email = email.trim() || null
      data.address = address
      data.occupation = occupation
      data.guardianName = null
      data.guardianPhone = null
      data.guardianEmail = null
      data.guardianAddress = null
      data.guardianOccupation = null
    }

    await submit(async () => {
      try {
        await updateMutation.mutateAsync(data)
        toast.success('Patient updated successfully')
        onOpenChange(false)
        onSaved?.()
        onCreated?.()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update patient'
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
        title="Edit Patient"
        description="Make changes to the patient's profile. Click save when you're done."
        size="md"
        submitLabel="Save Changes"
        footerFullWidth
        submitting={isSubmitting}
        submitDisabled={!isDirty || isSubmitting}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="edit-isChild"
              checked={isChild}
              onCheckedChange={(checked) => setIsChild(checked === true)}
            />
            <Label htmlFor="edit-isChild" className="cursor-pointer">
              Patient is a child
            </Label>
          </div>

          <Separator />

          <AvatarUpload
            entityName={name}
            onUrlChange={setProfileImageUrl}
            defaultAvatar={profileImageUrl || undefined}
          />

          <div className="space-y-2">
            <Label htmlFor="edit-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-dob">
                Date of Birth <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-dob"
                type="date"
                max={localDateISO()}
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Age</Label>
              <Input value={calculateAge(dob) ?? ''} disabled readOnly className="bg-muted" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-gender">
              Gender <span className="text-destructive">*</span>
            </Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger id="edit-gender">
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                {PATIENT_GENDERS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* §2.7 — tag picker (replaces the Patient Type select) */}
          <TagPicker value={tagIds} onChange={setTagIds} onCatalogLoaded={setTagCatalog} />

          {/* Insurance Fields */}
          {isInsuranceSelected && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Insurance Details</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>
                      Insurance Provider <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={insuranceProvider}
                      onValueChange={setInsuranceProvider}
                      disabled={!insuranceCompaniesLoading && insuranceCompanies.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {insuranceCompanies.map((company) => (
                          <SelectItem key={company.id} value={company.id}>
                            {company.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* [Medium] The dropdown used to just open empty with no
                        explanation while marked required. */}
                    {!insuranceCompaniesLoading && insuranceCompanies.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No insurance providers configured yet — add one in Settings → Insurance.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Insurance ID Number <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={insurancePolicyNumber}
                      onChange={(e) => setInsurancePolicyNumber(e.target.value)}
                      placeholder="e.g. INS-12345"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-nationality">Nationality</Label>
            <Input
              id="edit-nationality"
              value={nationality}
              onChange={(e) => setNationality(e.target.value)}
              placeholder="Ghana"
              maxLength={80}
            />
          </div>

          {isChild ? (
            <div className="space-y-4 rounded-md border bg-muted/20 p-4">
              <h4 className="text-sm font-medium text-muted-foreground">Guardian Information</h4>
              <div className="space-y-2">
                <Label htmlFor="edit-guardianName">
                  Guardian Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-guardianName"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-guardianPhone">
                  Guardian Phone <span className="text-destructive">*</span>
                </Label>
                <PhoneInput
                  id="edit-guardianPhone"
                  name="edit-guardianPhone"
                  defaultCountry="GH"
                  flags={flags}
                  value={toE164Phone(guardianPhone)}
                  onChange={(val) => setGuardianPhone(toStoredPhone(val))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-guardianEmail">Guardian Email</Label>
                <Input
                  id="edit-guardianEmail"
                  type="email"
                  value={guardianEmail}
                  onChange={(e) => setGuardianEmail(e.target.value)}
                  maxLength={254}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-guardianOccupation">Guardian Occupation</Label>
                <Input
                  id="edit-guardianOccupation"
                  value={guardianOccupation}
                  onChange={(e) => setGuardianOccupation(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-guardianAddress">Guardian Address</Label>
                <Input
                  id="edit-guardianAddress"
                  value={guardianAddress}
                  onChange={(e) => setGuardianAddress(e.target.value)}
                  maxLength={200}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">
                  Phone <span className="text-destructive">*</span>
                </Label>
                <PhoneInput
                  id="edit-phone"
                  name="edit-phone"
                  defaultCountry="GH"
                  flags={flags}
                  value={toE164Phone(phone)}
                  onChange={(val) => setPhone(toStoredPhone(val))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-occupation">Occupation</Label>
                <Input
                  id="edit-occupation"
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-address">
                  Address <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  maxLength={200}
                />
              </div>
            </>
          )}

          {/* ── How did you hear about us — same field set as registration ── */}
          <Separator />
          <div className="space-y-3">
            <Label className="text-sm font-semibold">How did you hear about us?</Label>
            <RadioGroup
              value={howDidYouHear}
              onValueChange={setHowDidYouHear}
              className="grid grid-cols-2 gap-2"
            >
              {HOW_DID_YOU_HEAR.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                    howDidYouHear === opt.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <RadioGroupItem value={opt.value} id={`edit-hear-${opt.value}`} />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </RadioGroup>

            {howDidYouHear === 'other' && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-hear-other">Please specify</Label>
                <Input
                  id="edit-hear-other"
                  value={howDidYouHearOther}
                  onChange={(e) => setHowDidYouHearOther(e.target.value)}
                  placeholder="How did you find us?"
                />
              </div>
            )}
          </div>
        </div>
      </SheetFormLayout>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
