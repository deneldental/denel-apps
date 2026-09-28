import { isValidPhoneNumber } from 'libphonenumber-js'
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { TagPicker } from '@/features/patients/components/tag-picker'
import { isValidEmail } from '@/features/patients/lib/email-format'
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

export function AddPatientDialog() {
  const { isSubmitting, submit } = useSubmitGuard()
  const [open, setOpen] = useState(false)
  const [isChild, setIsChild] = useState(false)
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(1)
  const [gender, setGender] = useState<string>('')
  // §2.7 — manual tag ids (replaces patient type); backend auto-applies Pediatric.
  const [tagIds, setTagIds] = useState<string[]>([])
  // Store step 1 values for child patients
  const [childName, setChildName] = useState<string>('')
  const [childDob, setChildDob] = useState<string>('')
  const [adultDob, setAdultDob] = useState<string>('')
  const [nationality, setNationality] = useState<string>('Ghana')
  const [tagCatalog, setTagCatalog] = useState<PatientTag[]>([])
  const { companies: insuranceCompanies } = useInsuranceCompanies(open)
  const [insuranceProvider, setInsuranceProvider] = useState('')
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState('')

  // Bound to systemKey, not the display name: duplicate 'Insurance'/
  // 'insurance' rows used to make this pick an arbitrary one, so ticking the
  // chip did not reliably reveal the provider/policy fields.
  const insuranceTag = findTagBySystemKey(tagCatalog, 'insurance')
  const isInsuranceSelected = insuranceTag ? tagIds.includes(insuranceTag.id) : false

  // Calculate age helper — uses current time on each call so age stays accurate.
  const calculateAge = (dobString: string) => {
    if (!dobString) return null
    const dobDate = new Date(dobString)
    const now = new Date()
    const diff = now.getTime() - dobDate.getTime()
    const ageDate = new Date(diff)
    return Math.abs(ageDate.getUTCFullYear() - 1970)
  }

  const _age = isChild ? calculateAge(childDob) : calculateAge(adultDob)

  const handleImageChange = (url: string | null) => {
    setProfileImageUrl(url)
  }

  function resetFormState() {
    setIsChild(false)
    setProfileImageUrl(null)
    setCurrentStep(1)
    setGender('')
    setTagIds([])
    setChildName('')
    setChildDob('')
    setAdultDob('')
    setNationality('Ghana')
    setInsuranceProvider('')
    setInsurancePolicyNumber('')
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // For child patients, ensure we're on step 2 before submitting
    if (isChild && currentStep === 1) {
      toast.error('Please complete all steps before submitting')
      return
    }

    const formData = new FormData(event.currentTarget)

    // Get values from form, with fallback to state for child patients
    const name = isChild ? childName : (formData.get('name') as string)
    const dobValue = isChild ? childDob : (formData.get('dob') as string)
    const genderValue = (formData.get('gender') as string) || gender
    const phoneValue = isChild
      ? (formData.get('guardianPhone') as string)
      : (formData.get('phone') as string)

    // Validate required fields with specific error messages
    if (!name || name.trim() === '') {
      toast.error("Please enter the patient's name")
      return
    }

    if (!phoneValue || phoneValue.trim() === '') {
      toast.error(
        isChild ? "Please enter the guardian's phone number" : 'Please enter the phone number'
      )
      return
    }

    // Phone validation — single check handles both local and international formats
    if (!isValidPhoneNumber(phoneValue, 'GH')) {
      toast.error('Please enter a valid phone number')
      return
    }

    if (!dobValue || dobValue.trim() === '') {
      toast.error('Please enter the date of birth')
      return
    }

    // DOB cannot be in the future
    if (new Date(dobValue) > new Date()) {
      toast.error('Date of birth cannot be in the future')
      return
    }

    if (!genderValue || genderValue.trim() === '') {
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

    interface PatientData {
      name: string
      gender: string
      dob: string
      isChild: boolean
      // §2.7 — tags replace the legacy type/isOrtho fields.
      tagIds: string[]
      profileImage?: string
      guardianName?: string
      guardianPhone?: string
      guardianEmail?: string
      guardianAddress?: string
      guardianOccupation?: string
      phone?: string
      email?: string
      address?: string
      occupation?: string
      nationality?: string
      insuranceProvider?: string
      insurancePolicyNumber?: string
    }

    const data: PatientData = {
      name: name,
      gender: genderValue,
      // Send the raw YYYY-MM-DD string — backend schema expects z.string() and parses it itself
      dob: dobValue,
      isChild: isChild,
      tagIds,
      profileImage: profileImageUrl || undefined,
      nationality: nationality || 'Ghana',
    }

    if (isInsuranceSelected) {
      data.insuranceProvider = insuranceProvider
      data.insurancePolicyNumber = insurancePolicyNumber
    }

    if (isChild) {
      // Child patient — guardian fields required; phone maps to guardian phone
      data.guardianName = formData.get('guardianName') as string
      data.guardianPhone = phoneValue
      // phone is required by backend schema — map guardian phone so zod passes
      data.phone = phoneValue
      data.guardianEmail = (formData.get('guardianEmail') as string) || undefined
      data.guardianAddress = formData.get('guardianAddress') as string
      data.guardianOccupation = formData.get('guardianOccupation') as string

      if (!data.guardianName || data.guardianName.trim() === '') {
        toast.error("Please enter the guardian's name")
        return
      }
      if (!data.guardianAddress || data.guardianAddress.trim() === '') {
        toast.error("Please enter the guardian's address")
        return
      }
      if (!data.guardianOccupation || data.guardianOccupation.trim() === '') {
        toast.error("Please enter the guardian's occupation")
        return
      }
      // Guardian email format check (field is optional but must be valid if provided)
      if (data.guardianEmail && !isValidEmail(data.guardianEmail)) {
        toast.error('Please enter a valid guardian email address')
        return
      }
    } else {
      // Adult patient
      data.phone = phoneValue
      data.email = ((formData.get('email') as string) || '').trim() || undefined
      data.address = formData.get('address') as string
      data.occupation = formData.get('occupation') as string

      if (data.email && !isValidEmail(data.email)) {
        toast.error('Please enter a valid email address')
        return
      }
      if (!data.address || data.address.trim() === '') {
        toast.error('Please enter the address')
        return
      }
      if (!data.occupation || data.occupation.trim() === '') {
        toast.error('Please enter the occupation')
        return
      }
    }

    await submit(async () => {
      // createPatient's parameter is typed from Drizzle's $inferInsert (dob: Date),
      // but the API route accepts dob as a z.string() and parses it server-side.
      // We cast here to avoid a Drizzle-type vs wire-type mismatch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await createPatient(data as any)

      if (result.success) {
        resetFormState()

        try {
          const form = event.currentTarget
          if (form) form.reset()
        } catch {
          // Silently ignore form reset errors
        }

        setOpen(false)
        toast.success('Patient created successfully.')
      } else {
        surfaceApiError(result)
      }
    })
  }

  // Dirty if any meaningful field has been touched
  const isDirty =
    !!childName ||
    !!childDob ||
    !!adultDob ||
    !!gender ||
    tagIds.length > 0 ||
    !!profileImageUrl ||
    !!insuranceProvider ||
    !!insurancePolicyNumber

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => {
      setOpen(false)
      resetFormState()
    },
  })

  return (
    <>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <Sheet
        open={open}
        onOpenChange={(newOpen) => {
          if (newOpen) {
            setOpen(true)
          } else {
            guardedOnOpenChange(false)
          }
        }}
      >
        <SheetTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Patient
          </Button>
        </SheetTrigger>
        <SheetContent className="sm:max-w-[500px] md:max-w-[600px] overflow-y-auto w-full sm:w-[90vw]">
          <form onSubmit={onSubmit}>
            <SheetHeader>
              <SheetTitle>Add Patient</SheetTitle>
              <SheetDescription>
                Enter the patient&apos;s details here. All fields are required except email.
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-6 py-4">
              {/* Profile Image (First item) */}
              <div className="flex justify-center mb-2">
                <AvatarUpload
                  entityName={childName || 'patient'}
                  onUrlChange={handleImageChange}
                  defaultAvatar={profileImageUrl || undefined}
                />
              </div>

              <Separator />

              {/* Age Group Selection */}
              <div className="space-y-3">
                <Label className="text-base font-semibold">Patient Category</Label>
                <RadioGroup
                  value={isChild ? 'child' : 'adult'}
                  onValueChange={(value) => {
                    setIsChild(value === 'child')
                    setCurrentStep(1)
                  }}
                  className="flex flex-col space-y-2 mt-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="adult" id="adult" />
                    <Label htmlFor="adult" className="cursor-pointer font-normal">
                      Patient is an adult
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="child" id="child" />
                    <Label htmlFor="child" className="cursor-pointer font-normal">
                      This patient is a child
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <Separator />

              {isChild ? (
                /* Child Patient - Stepper Layout */
                <div className="w-full">
                  {/* Stepper Indicator */}
                  <div className="flex items-center justify-center mb-6">
                    <div className="flex items-center">
                      {/* Step 1 */}
                      <div className="flex items-center">
                        <div
                          className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                            currentStep >= 1
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background border-muted-foreground text-muted-foreground'
                          }`}
                        >
                          {currentStep > 1 ? (
                            <svg
                              className="w-6 h-6"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          ) : (
                            '1'
                          )}
                        </div>
                        <div
                          className={`ml-2 text-sm font-medium ${
                            currentStep >= 1 ? 'text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          Child Info
                        </div>
                      </div>

                      {/* Connector */}
                      <div
                        className={`w-16 h-0.5 mx-4 ${currentStep >= 2 ? 'bg-primary' : 'bg-muted'}`}
                      />

                      {/* Step 2 */}
                      <div className="flex items-center">
                        <div
                          className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                            currentStep >= 2
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background border-muted-foreground text-muted-foreground'
                          }`}
                        >
                          2
                        </div>
                        <div
                          className={`ml-2 text-sm font-medium ${
                            currentStep >= 2 ? 'text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          Parent Info
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step Content */}
                  {currentStep === 1 && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                          id="name"
                          name="name"
                          value={childName}
                          onChange={(e) => setChildName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="dob">DOB</Label>
                          <Input
                            id="dob"
                            name="dob"
                            type="date"
                            max={localDateISO()}
                            value={childDob}
                            onChange={(e) => setChildDob(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Age</Label>
                          <Input
                            value={calculateAge(childDob) ?? ''}
                            disabled
                            readOnly
                            className="bg-muted"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="gender">Gender</Label>
                          <Select name="gender" value={gender} onValueChange={setGender} required>
                            <SelectTrigger>
                              <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
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
                                <Label>Insurance Provider</Label>
                                <Select
                                  value={insuranceProvider}
                                  onValueChange={setInsuranceProvider}
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
                              </div>
                              <div className="space-y-1.5">
                                <Label>Insurance ID Number</Label>
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
                      {/* Hidden inputs to preserve step 1 data */}
                      <input type="hidden" name="name" value={childName} />
                      <input type="hidden" name="dob" value={childDob} />
                      <input type="hidden" name="gender" value={gender} />

                      <div className="space-y-2">
                        <Label htmlFor="guardianName">Guardian Name</Label>
                        <Input id="guardianName" name="guardianName" required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="guardianPhone">Guardian Phone</Label>
                        <Input
                          id="guardianPhone"
                          name="guardianPhone"
                          placeholder="+233..."
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="guardianOccupation">Guardian Occupation</Label>
                        <Input id="guardianOccupation" name="guardianOccupation" required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="guardianAddress">Guardian Address</Label>
                        <Input id="guardianAddress" name="guardianAddress" required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="guardianEmail">Guardian Email (Optional)</Label>
                        <Input id="guardianEmail" name="guardianEmail" type="email" />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Adult Patient - Regular Form */
                <>
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" name="name" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" name="phone" placeholder="+233..." required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email (optional)</Label>
                    <Input id="email" name="email" type="email" placeholder="name@example.com" />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="dob">DOB</Label>
                      <Input
                        id="dob"
                        name="dob"
                        type="date"
                        max={localDateISO()}
                        required
                        value={adultDob}
                        onChange={(e) => setAdultDob(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Age</Label>
                      <Input
                        value={calculateAge(adultDob) ?? ''}
                        disabled
                        readOnly
                        className="bg-muted"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gender">Gender</Label>
                      <Select name="gender" value={gender} onValueChange={setGender} required>
                        <SelectTrigger>
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
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
                            <Label>Insurance Provider</Label>
                            <Select value={insuranceProvider} onValueChange={setInsuranceProvider}>
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
                          </div>
                          <div className="space-y-1.5">
                            <Label>Insurance ID Number</Label>
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
                    <Label htmlFor="occupation">Occupation</Label>
                    <Input id="occupation" name="occupation" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input id="address" name="address" required />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="nationality">Nationality</Label>
                    <Input
                      id="nationality"
                      value={nationality}
                      onChange={(e) => setNationality(e.target.value)}
                      placeholder="Ghana"
                    />
                  </div>
                </>
              )}
            </div>
            <SheetFooter className="mt-6">
              {isChild && currentStep === 1 ? (
                <Button
                  type="button"
                  onClick={() => {
                    // Validate step 1 fields before proceeding
                    if (!childName || childName.trim() === '') {
                      toast.error("Please enter the child's name")
                      return
                    }
                    if (!childDob || childDob.trim() === '') {
                      toast.error('Please enter the date of birth')
                      return
                    }
                    if (!gender || gender.trim() === '') {
                      toast.error('Please select a gender')
                      return
                    }
                    setCurrentStep(2)
                  }}
                >
                  Next
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <div className="flex gap-2 w-full justify-between">
                  {isChild && currentStep === 2 && (
                    <Button type="button" variant="outline" onClick={() => setCurrentStep(1)}>
                      <ChevronLeft className="mr-2 h-4 w-4" />
                      Previous
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className={isChild && currentStep === 2 ? 'ml-auto' : ''}
                  >
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save changes
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
