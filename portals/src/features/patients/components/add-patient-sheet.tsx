import { isValidPhoneNumber } from 'libphonenumber-js/max'
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import 'react-phone-number-input/style.css'
import PhoneInput from 'react-phone-number-input'
// Bundled flag components. Without this the library fetches every flag from
// purecatamphetamine.github.io at runtime — an external dependency we do not
// want in the clinic's network path.
import flags from 'react-phone-number-input/flags'
import { TagPicker } from '@/features/patients/components/tag-picker'
import { PATIENT_GENDERS } from '@/features/patients/lib/patient-genders'
import { toE164Phone, toStoredPhone } from '@/features/patients/lib/phone-format'
import { findTagBySystemKey, type PatientTag } from '@/lib/actions/patient-tags'
import { createPatient } from '@/lib/actions/patients'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import AvatarUpload from '@/shared/components/ui/avatar-upload'
import { Button } from '@/shared/components/ui/button'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useInsuranceCompanies } from '@/shared/hooks/use-insurance-companies'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO } from '@/shared/lib/dates'

// ─── Types ────────────────────────────────────────────────────────────────────

const HOW_DID_YOU_HEAR = [
  { value: 'friend_family', label: 'Friend / Family' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'google', label: 'Google Search' },
  { value: 'other', label: 'Others' },
]

// ─── Component ────────────────────────────────────────────────────────────────

interface AddPatientSheetProps {
  /** Called after successful creation. Receives the new patient id when available. */
  onCreated?: (patientId?: string) => void
  trigger?: React.ReactNode
}

export function AddPatientSheet({ onCreated, trigger }: AddPatientSheetProps) {
  const [open, setOpen] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()
  const [isChild, setIsChild] = useState(false)
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(1)
  const [gender, setGender] = useState('')
  const [childName, setChildName] = useState('')
  const [childDob, setChildDob] = useState('')
  const [adultDob, setAdultDob] = useState('')
  const [nationality, setNationality] = useState('Ghanaian')
  const [howDidYouHear, setHowDidYouHear] = useState('')
  const [howDidYouHearOther, setHowDidYouHearOther] = useState('')
  const [phone, setPhone] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  // §2.7 — manual tags chosen on creation (Pediatric is auto-applied by the
  // backend from isChild; treatment-derived tags apply later).
  const [tagIds, setTagIds] = useState<string[]>([])
  const [tagCatalog, setTagCatalog] = useState<PatientTag[]>([])
  const { companies: insuranceCompanies, isLoading: insuranceCompaniesLoading } =
    useInsuranceCompanies(open)
  const [insuranceProvider, setInsuranceProvider] = useState('')
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState('')

  // Bound to systemKey, not the display name: duplicate 'Insurance'/
  // 'insurance' rows used to make this pick an arbitrary one, so ticking the
  // chip did not reliably reveal the provider/policy fields.
  const insuranceTag = findTagBySystemKey(tagCatalog, 'insurance')
  const isInsuranceSelected = insuranceTag ? tagIds.includes(insuranceTag.id) : false

  const isDirty =
    childName !== '' ||
    childDob !== '' ||
    adultDob !== '' ||
    gender !== '' ||
    howDidYouHear !== '' ||
    howDidYouHearOther !== '' ||
    profileImageUrl !== null ||
    tagIds.length > 0 ||
    nationality !== 'Ghanaian' ||
    insuranceProvider !== '' ||
    insurancePolicyNumber !== '' ||
    phone !== '' ||
    guardianPhone !== ''

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => {
      reset()
      setOpen(false)
    },
  })

  // [Medium] Math.abs() used to flip a future DOB's negative time-since-epoch
  // into a plausible-looking positive age instead of flagging the mistake —
  // a future date silently previewed as if it were a real age. A future date
  // now returns null (blank preview) instead of a wrong number. `max` on the
  // date inputs below additionally stops most future dates from ever being
  // picked in the first place, matching add-patient-dialog.tsx's convention.
  const calculateAge = (dobString: string) => {
    if (!dobString) return null
    const dob = new Date(dobString)
    const ageYears = new Date(Date.now() - dob.getTime()).getUTCFullYear() - 1970
    return ageYears < 0 ? null : ageYears
  }

  function reset() {
    setIsChild(false)
    setProfileImageUrl(null)
    setCurrentStep(1)
    setGender('')
    setTagIds([])
    setChildName('')
    setChildDob('')
    setAdultDob('')
    setNationality('Ghanaian')
    setHowDidYouHear('')
    setHowDidYouHearOther('')
    setInsuranceProvider('')
    setInsurancePolicyNumber('')
    setPhone('')
    setGuardianPhone('')
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isChild && currentStep === 1) {
      toast.error('Please complete all steps before submitting')
      return
    }

    const formData = new FormData(event.currentTarget)
    const name = isChild ? childName : (formData.get('name') as string)
    const dobValue = isChild ? childDob : (formData.get('dob') as string)
    const genderValue = gender
    const phoneValue = isChild ? guardianPhone : phone

    // Validation — all checks before any loading state change
    if (!name?.trim()) {
      toast.error("Please enter the patient's name")
      return
    }
    if (!phoneValue?.trim()) {
      toast.error(
        isChild ? "Please enter the guardian's phone number" : 'Please enter the phone number'
      )
      return
    }
    if (!isValidPhoneNumber(phoneValue, 'GH') && !isValidPhoneNumber(phoneValue)) {
      toast.error('Please enter a valid phone number (e.g. +233...)')
      return
    }
    if (!dobValue?.trim()) {
      toast.error('Please enter the date of birth')
      return
    }
    if (!genderValue) {
      toast.error('Please select a gender')
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

    const data: Record<string, unknown> = {
      name,
      gender: genderValue,
      // Send the raw YYYY-MM-DD string; the backend schema declares dob: z.string()
      // and parses it with new Date(data.dob) itself.
      dob: dobValue,
      isChild,
      // §2.7 — manual tag ids; backend auto-applies Pediatric from isChild.
      tagIds,
      profileImage: profileImageUrl ?? undefined,
      nationality,
      howDidYouHear: howDidYouHear || undefined,
      howDidYouHearOther: howDidYouHear === 'other' ? howDidYouHearOther : undefined,
    }

    if (isInsuranceSelected) {
      // the backend schema expects strings here, we store company ID as provider
      data.insuranceProvider = insuranceProvider
      data.insurancePolicyNumber = insurancePolicyNumber
    }

    if (isChild) {
      data.guardianName = formData.get('guardianName') as string
      data.guardianPhone = phoneValue
      // Backend createPatientSchema requires phone unconditionally — map guardian phone
      data.phone = phoneValue
      // guardianEmail removed
      data.guardianAddress = formData.get('guardianAddress') as string
      data.guardianOccupation = formData.get('guardianOccupation') as string

      if (!data.guardianName || !(data.guardianName as string).trim()) {
        toast.error("Please enter the guardian's name")
        return
      }
      if (!data.guardianAddress || !(data.guardianAddress as string).trim()) {
        toast.error("Please enter the guardian's address")
        return
      }
    } else {
      data.phone = phoneValue
      data.address = formData.get('address') as string
      data.occupation = formData.get('occupation') as string

      if (!data.address || !(data.address as string).trim()) {
        toast.error('Please enter the address')
        return
      }
      if (!data.occupation || !(data.occupation as string).trim()) {
        toast.error('Please enter the occupation')
        return
      }
    }

    await submit(async () => {
      const result = await createPatient(data as any)
      if (result.success) {
        reset()
        setOpen(false)
        toast.success('Patient created. Welcome SMS sent.')
        onCreated?.(result.data?.id as string | undefined)
      } else {
        surfaceApiError(result)
      }
    })
  }

  return (
    <>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (v) {
            setOpen(true)
          } else {
            guardedOnOpenChange(false)
          }
        }}
      >
        <SheetTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Patient
            </Button>
          )}
        </SheetTrigger>

        <SheetContent className="!w-full overflow-y-auto !max-w-[680px]">
          <form onSubmit={onSubmit}>
            <SheetHeader className="mb-4">
              <SheetTitle>Add New Patient</SheetTitle>
              <SheetDescription>
                Fill in the patient's details. A welcome SMS will be sent upon registration.
              </SheetDescription>
            </SheetHeader>

            <div className="grid gap-5 pb-6">
              {/* Avatar */}
              <div className="flex justify-center">
                <AvatarUpload
                  entityName={childName || 'patient'}
                  onUrlChange={setProfileImageUrl}
                  defaultAvatar={profileImageUrl ?? undefined}
                />
              </div>

              <Separator />

              {/* Adult / Child toggle */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Patient Category</Label>
                <RadioGroup
                  value={isChild ? 'child' : 'adult'}
                  onValueChange={(v) => {
                    setIsChild(v === 'child')
                    setCurrentStep(1)
                  }}
                  className="flex gap-6"
                >
                  <label className="flex cursor-pointer items-center gap-2">
                    <RadioGroupItem value="adult" id="cat-adult" />
                    <span className="text-sm">Adult</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <RadioGroupItem value="child" id="cat-child" />
                    <span className="text-sm">Child</span>
                  </label>
                </RadioGroup>
              </div>

              <Separator />

              {/* ── Child: two-step form ── */}
              {isChild ? (
                <div>
                  {/* Stepper */}
                  <div className="mb-6 flex items-center justify-center">
                    {[1, 2].map((step, i) => (
                      <div key={step} className="flex items-center">
                        {i > 0 && (
                          <div
                            className={`h-0.5 w-16 ${currentStep >= step ? 'bg-primary' : 'bg-muted'}`}
                          />
                        )}
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-medium ${
                            currentStep >= step
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted text-muted-foreground'
                          }`}
                        >
                          {currentStep > step ? '✓' : step}
                        </div>
                        <span
                          className={`ml-2 text-sm ${currentStep >= step ? 'font-medium' : 'text-muted-foreground'}`}
                        >
                          {step === 1 ? 'Child Info' : 'Guardian Info'}
                        </span>
                      </div>
                    ))}
                  </div>

                  {currentStep === 1 && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="child-name">
                          Full Name <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="child-name"
                          value={childName}
                          onChange={(e) => setChildName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="child-dob">
                            Date of Birth <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id="child-dob"
                            type="date"
                            max={localDateISO()}
                            value={childDob}
                            onChange={(e) => setChildDob(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Age</Label>
                          <Input
                            value={calculateAge(childDob) ?? ''}
                            readOnly
                            className="bg-muted"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>
                            Gender <span className="text-destructive">*</span>
                          </Label>
                          <Select value={gender} onValueChange={setGender}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
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
                      </div>
                      {/* §2.7 — tag picker (replaces the Patient Type select) */}
                      <TagPicker
                        value={tagIds}
                        onChange={setTagIds}
                        onCatalogLoaded={setTagCatalog}
                      />

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
                                  disabled={
                                    !insuranceCompaniesLoading && insuranceCompanies.length === 0
                                  }
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
                                    No insurance providers configured yet — add one in Settings →
                                    Insurance.
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
                    </div>
                  )}

                  {currentStep === 2 && (
                    <div className="space-y-4">
                      <input type="hidden" name="name" value={childName} />
                      <input type="hidden" name="dob" value={childDob} />
                      <input type="hidden" name="gender" value={gender} />

                      <div className="space-y-1.5">
                        <Label htmlFor="guardianName">
                          Guardian Name <span className="text-destructive">*</span>
                        </Label>
                        <Input id="guardianName" name="guardianName" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="guardianPhone">
                          Guardian Phone <span className="text-destructive">*</span>
                        </Label>
                        <PhoneInput
                          id="guardianPhone"
                          name="guardianPhone"
                          defaultCountry="GH"
                          flags={flags}
                          value={toE164Phone(guardianPhone)}
                          onChange={(val) => setGuardianPhone(toStoredPhone(val))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="guardianOccupation">
                          Guardian Occupation <span className="text-destructive">*</span>
                        </Label>
                        <Input id="guardianOccupation" name="guardianOccupation" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="guardianAddress">
                          Guardian Address <span className="text-destructive">*</span>
                        </Label>
                        <Input id="guardianAddress" name="guardianAddress" required />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Adult form ── */
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="name">
                      Full Name <span className="text-destructive">*</span>
                    </Label>
                    <Input id="name" name="name" required />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="phone">
                      Phone Number <span className="text-destructive">*</span>
                    </Label>
                    <PhoneInput
                      id="phone"
                      name="phone"
                      defaultCountry="GH"
                      flags={flags}
                      value={toE164Phone(phone)}
                      onChange={(val) => setPhone(toStoredPhone(val))}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="dob">
                        Date of Birth <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="dob"
                        name="dob"
                        type="date"
                        max={localDateISO()}
                        value={adultDob}
                        onChange={(e) => setAdultDob(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Age</Label>
                      <Input value={calculateAge(adultDob) ?? ''} readOnly className="bg-muted" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        Gender <span className="text-destructive">*</span>
                      </Label>
                      <Select value={gender} onValueChange={setGender}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
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
                              disabled={
                                !insuranceCompaniesLoading && insuranceCompanies.length === 0
                              }
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
                            {!insuranceCompaniesLoading && insuranceCompanies.length === 0 && (
                              <p className="text-xs text-muted-foreground">
                                No insurance providers configured yet — add one in Settings →
                                Insurance.
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

                  <div className="space-y-1.5">
                    <Label htmlFor="occupation">
                      Occupation <span className="text-destructive">*</span>
                    </Label>
                    <Input id="occupation" name="occupation" required />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="address">
                      Address <span className="text-destructive">*</span>
                    </Label>
                    <Input id="address" name="address" required />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="nationality">Nationality</Label>
                    <Input
                      id="nationality"
                      value={nationality}
                      onChange={(e) => setNationality(e.target.value)}
                      placeholder="Ghanaian"
                    />
                  </div>
                </>
              )}

              {/* ── How did you hear about us — shown for both adult and child step 2 ── */}
              {(!isChild || currentStep === 2) && (
                <>
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
                          <RadioGroupItem value={opt.value} id={`hear-${opt.value}`} />
                          <span className="text-sm">{opt.label}</span>
                        </label>
                      ))}
                    </RadioGroup>

                    {howDidYouHear === 'other' && (
                      <div className="space-y-1.5">
                        <Label htmlFor="hear-other">Please specify</Label>
                        <Input
                          id="hear-other"
                          value={howDidYouHearOther}
                          onChange={(e) => setHowDidYouHearOther(e.target.value)}
                          placeholder="How did you find us?"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <SheetFooter className="mt-4 pb-6">
              {isChild && currentStep === 1 ? (
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    if (!childName.trim()) {
                      toast.error("Enter the child's name")
                      return
                    }
                    if (!childDob.trim()) {
                      toast.error('Enter the date of birth')
                      return
                    }
                    if (!gender) {
                      toast.error('Select a gender')
                      return
                    }
                    setCurrentStep(2)
                  }}
                >
                  Next
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <div className="flex w-full items-center gap-2">
                  {isChild && currentStep === 2 && (
                    <Button type="button" variant="outline" onClick={() => setCurrentStep(1)}>
                      <ChevronLeft className="mr-2 h-4 w-4" />
                      Previous
                    </Button>
                  )}
                  <Button type="submit" disabled={isSubmitting} className="flex-1">
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Register Patient
                  </Button>
                </div>
              )}
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}
