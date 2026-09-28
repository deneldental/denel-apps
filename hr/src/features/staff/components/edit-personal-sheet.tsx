import { GENDERS, type Gender, MARITAL_STATUSES, type MaritalStatus } from '@denel/types'
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Textarea,
} from '@denel/ui'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { updateStaff } from '@/lib/actions/staff'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO } from '@/shared/lib/dates'

/** Sentinel for "no value" — Radix Select can't hold an empty-string value. */
const UNSET = '__unset__'

const GENDER_LABELS: Record<Gender, string> = {
  male: 'Male',
  female: 'Female',
}

const MARITAL_LABELS: Record<MaritalStatus, string> = {
  single: 'Single',
  married: 'Married',
  divorced: 'Divorced',
  widowed: 'Widowed',
}

interface StaffRecord {
  id: string
  dateOfBirth: string | Date | null
  gender: string | null
  nationality: string | null
  maritalStatus: string | null
  ghanaCardPin: string | null
  residentialAddress: string | null
  digitalAddress: string | null
  emergencyContactName: string | null
  emergencyContactRelationship: string | null
  emergencyContactPhone: string | null
  nextOfKinName: string | null
  nextOfKinRelationship: string | null
  nextOfKinPhone: string | null
  highestQualification: string | null
  institution: string | null
  qualificationYear: number | null
}

/**
 * Per-section Personal editor — the correct surface for employee master data.
 *
 * Every field here used to be write-once: self-registration collected them,
 * the approval handler wrote them to `staff`, and then NOTHING in the HR app
 * could display or change them. They weren't on any screen and weren't in the
 * backend's writable allowlist, so a typo'd Ghana Card PIN or next-of-kin phone
 * was frozen for the life of the record — the only read path was the Employee
 * Data Sheet PDF. See project-docs/staff-personal-data-build-plan.md.
 *
 * Emergency contact + next of kin live HERE rather than in the Employment sheet:
 * they're personal data, not employment terms, and the relationship field only
 * exists on this side — splitting the triple across two sheets was how the
 * emergency contact ended up half-editable in the first place.
 */
export function EditPersonalSheet({
  open,
  onOpenChange,
  staff,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: StaffRecord
  onSaved: () => void
}) {
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState<string>(UNSET)
  const [nationality, setNationality] = useState('')
  const [maritalStatus, setMaritalStatus] = useState<string>(UNSET)
  const [ghanaCardPin, setGhanaCardPin] = useState('')
  const [residentialAddress, setResidentialAddress] = useState('')
  const [digitalAddress, setDigitalAddress] = useState('')
  const [emergencyContactName, setEmergencyContactName] = useState('')
  const [emergencyContactRelationship, setEmergencyContactRelationship] = useState('')
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('')
  const [nextOfKinName, setNextOfKinName] = useState('')
  const [nextOfKinRelationship, setNextOfKinRelationship] = useState('')
  const [nextOfKinPhone, setNextOfKinPhone] = useState('')
  const [highestQualification, setHighestQualification] = useState('')
  const [institution, setInstitution] = useState('')
  const [qualificationYear, setQualificationYear] = useState('')
  const { isSubmitting, submit } = useSubmitGuard()

  const initial = useMemo(
    () => ({
      dateOfBirth: staff.dateOfBirth ? localDateISO(new Date(staff.dateOfBirth)) : '',
      gender: staff.gender ?? UNSET,
      nationality: staff.nationality ?? '',
      maritalStatus: staff.maritalStatus ?? UNSET,
      ghanaCardPin: staff.ghanaCardPin ?? '',
      residentialAddress: staff.residentialAddress ?? '',
      digitalAddress: staff.digitalAddress ?? '',
      emergencyContactName: staff.emergencyContactName ?? '',
      emergencyContactRelationship: staff.emergencyContactRelationship ?? '',
      emergencyContactPhone: staff.emergencyContactPhone ?? '',
      nextOfKinName: staff.nextOfKinName ?? '',
      nextOfKinRelationship: staff.nextOfKinRelationship ?? '',
      nextOfKinPhone: staff.nextOfKinPhone ?? '',
      highestQualification: staff.highestQualification ?? '',
      institution: staff.institution ?? '',
      qualificationYear:
        staff.qualificationYear === null || staff.qualificationYear === undefined
          ? ''
          : String(staff.qualificationYear),
    }),
    [staff]
  )

  useEffect(() => {
    if (!open) return
    setDateOfBirth(initial.dateOfBirth)
    setGender(initial.gender)
    setNationality(initial.nationality)
    setMaritalStatus(initial.maritalStatus)
    setGhanaCardPin(initial.ghanaCardPin)
    setResidentialAddress(initial.residentialAddress)
    setDigitalAddress(initial.digitalAddress)
    setEmergencyContactName(initial.emergencyContactName)
    setEmergencyContactRelationship(initial.emergencyContactRelationship)
    setEmergencyContactPhone(initial.emergencyContactPhone)
    setNextOfKinName(initial.nextOfKinName)
    setNextOfKinRelationship(initial.nextOfKinRelationship)
    setNextOfKinPhone(initial.nextOfKinPhone)
    setHighestQualification(initial.highestQualification)
    setInstitution(initial.institution)
    setQualificationYear(initial.qualificationYear)
  }, [open, initial])

  const current = {
    dateOfBirth,
    gender,
    nationality,
    maritalStatus,
    ghanaCardPin,
    residentialAddress,
    digitalAddress,
    emergencyContactName,
    emergencyContactRelationship,
    emergencyContactPhone,
    nextOfKinName,
    nextOfKinRelationship,
    nextOfKinPhone,
    highestQualification,
    institution,
    qualificationYear,
  }

  const isDirty = useMemo(
    () =>
      (Object.keys(initial) as Array<keyof typeof initial>).some((k) => current[k] !== initial[k]),
    // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is rebuilt every render by design
    [initial, ...Object.values(current), current]
  )

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => onOpenChange(false),
  })

  function handleSubmit() {
    void submit(async () => {
      if (dateOfBirth && Number.isNaN(new Date(dateOfBirth).getTime())) {
        toast.error('Date of birth is not a valid date.')
        return
      }
      let yearPayload: number | null = null
      if (qualificationYear.trim()) {
        const parsed = Number(qualificationYear)
        if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
          toast.error('Year of qualification must be a whole year between 1900 and 2100.')
          return
        }
        yearPayload = parsed
      }

      const res = await updateStaff(staff.id, {
        // Sending an ISO string, not a Date — the backend coerces. `null` clears.
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth).toISOString() : null,
        gender: gender === UNSET ? null : gender,
        nationality: nationality.trim() || null,
        maritalStatus: maritalStatus === UNSET ? null : maritalStatus,
        ghanaCardPin: ghanaCardPin.trim() || null,
        residentialAddress: residentialAddress.trim() || null,
        digitalAddress: digitalAddress.trim() || null,
        emergencyContactName: emergencyContactName.trim() || null,
        emergencyContactRelationship: emergencyContactRelationship.trim() || null,
        emergencyContactPhone: emergencyContactPhone.trim() || null,
        nextOfKinName: nextOfKinName.trim() || null,
        nextOfKinRelationship: nextOfKinRelationship.trim() || null,
        nextOfKinPhone: nextOfKinPhone.trim() || null,
        highestQualification: highestQualification.trim() || null,
        institution: institution.trim() || null,
        qualificationYear: yearPayload,
      } as never)
      if (!res.success) {
        surfaceApiError(res, 'Failed to update personal details')
        return
      }
      toast.success('Personal details updated.')
      onSaved()
      onOpenChange(false)
    })
  }

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Edit personal details"
        description="Biographical data, identification, address, emergency contacts, and education."
        size="lg"
        submitLabel="Save changes"
        submitting={isSubmitting}
        submitDisabled={!isDirty}
        onSubmit={handleSubmit}
      >
        <div className="grid gap-6">
          {/* ── Biographical ── */}
          <div className="grid gap-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Biographical
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-dob">Date of birth</Label>
                <Input
                  id="edit-dob"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Drives the birthday reminder; the year is used for statutory age checks.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-gender">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger id="edit-gender">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not set</SelectItem>
                    {GENDERS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {GENDER_LABELS[g]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-nationality">Nationality</Label>
                <Input
                  id="edit-nationality"
                  placeholder="e.g. Ghanaian"
                  maxLength={100}
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-marital">Marital status</Label>
                <Select value={maritalStatus} onValueChange={setMaritalStatus}>
                  <SelectTrigger id="edit-marital">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not set</SelectItem>
                    {MARITAL_STATUSES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {MARITAL_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Identification + address ── */}
          <div className="grid gap-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Identification &amp; address
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-ghana-card">Ghana Card PIN</Label>
                <Input
                  id="edit-ghana-card"
                  placeholder="GHA-000000000-0"
                  maxLength={30}
                  value={ghanaCardPin}
                  onChange={(e) => setGhanaCardPin(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-digital-address">Digital address</Label>
                <Input
                  id="edit-digital-address"
                  placeholder="GhanaPost GPS, e.g. GA-123-4567"
                  maxLength={30}
                  value={digitalAddress}
                  onChange={(e) => setDigitalAddress(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-residential-address">Residential address</Label>
              <Textarea
                id="edit-residential-address"
                rows={2}
                maxLength={500}
                value={residentialAddress}
                onChange={(e) => setResidentialAddress(e.target.value)}
              />
            </div>
          </div>

          <Separator />

          {/* ── Emergency contact ── */}
          <div className="grid gap-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Emergency contact
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-ec-name">Name</Label>
                <Input
                  id="edit-ec-name"
                  maxLength={200}
                  value={emergencyContactName}
                  onChange={(e) => setEmergencyContactName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-ec-rel">Relationship</Label>
                <Input
                  id="edit-ec-rel"
                  placeholder="e.g. Sister"
                  maxLength={50}
                  value={emergencyContactRelationship}
                  onChange={(e) => setEmergencyContactRelationship(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-ec-phone">Phone</Label>
                <Input
                  id="edit-ec-phone"
                  type="tel"
                  maxLength={30}
                  value={emergencyContactPhone}
                  onChange={(e) => setEmergencyContactPhone(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* ── Next of kin ── */}
          <div className="grid gap-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Next of kin
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-nok-name">Name</Label>
                <Input
                  id="edit-nok-name"
                  maxLength={200}
                  value={nextOfKinName}
                  onChange={(e) => setNextOfKinName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-nok-rel">Relationship</Label>
                <Input
                  id="edit-nok-rel"
                  placeholder="e.g. Father"
                  maxLength={50}
                  value={nextOfKinRelationship}
                  onChange={(e) => setNextOfKinRelationship(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-nok-phone">Phone</Label>
                <Input
                  id="edit-nok-phone"
                  type="tel"
                  maxLength={30}
                  value={nextOfKinPhone}
                  onChange={(e) => setNextOfKinPhone(e.target.value)}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Education ── */}
          <div className="grid gap-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Education
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-qualification">Highest qualification</Label>
                <Input
                  id="edit-qualification"
                  placeholder="e.g. BSc Dental Surgery"
                  maxLength={200}
                  value={highestQualification}
                  onChange={(e) => setHighestQualification(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-institution">Institution</Label>
                <Input
                  id="edit-institution"
                  maxLength={200}
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-qual-year">Year</Label>
                <Input
                  id="edit-qual-year"
                  type="number"
                  min={1900}
                  max={2100}
                  step={1}
                  value={qualificationYear}
                  onChange={(e) => setQualificationYear(e.target.value)}
                />
              </div>
            </div>
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
