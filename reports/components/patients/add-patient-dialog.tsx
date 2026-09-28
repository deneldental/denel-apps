import { isValidPhoneNumber } from 'libphonenumber-js'
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import AvatarUpload from '@/components/ui/avatar-upload'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { createPatient } from '@/lib/actions/patients'

const NOW = new Date()

export function AddPatientDialog() {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isChild, setIsChild] = useState(false)
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(1)
  const [gender, setGender] = useState<string>('')
  const [patientType, setPatientType] = useState<string>('general')
  // Store step 1 values for child patients
  const [childName, setChildName] = useState<string>('')
  const [childDob, setChildDob] = useState<string>('')
  const [adultDob, setAdultDob] = useState<string>('')
  const [nationality, setNationality] = useState<string>('Ghana')

  // Calculate age helper (based on load-time "now" to keep render pure)
  const calculateAge = (dobString: string) => {
    if (!dobString) return null
    const dobDate = new Date(dobString)
    const diff = NOW.getTime() - dobDate.getTime()
    const ageDate = new Date(diff)
    return Math.abs(ageDate.getUTCFullYear() - 1970)
  }

  const _age = isChild ? calculateAge(childDob) : calculateAge(adultDob)

  const handleImageChange = (url: string | null) => {
    setProfileImageUrl(url)
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
    const typeValue = (formData.get('type') as string) || patientType

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

    // Phone validation
    if (phoneValue && !isValidPhoneNumber(phoneValue, 'GH')) {
      // Assuming GH (Ghana) based on previous context or default to a safe check
      // If it doesn't start with +, let's try with default country
      if (!phoneValue.startsWith('+') && !isValidPhoneNumber(phoneValue, 'GH')) {
        toast.error('Please enter a valid phone number')
        return
      }
    }

    if (!dobValue || dobValue.trim() === '') {
      toast.error('Please enter the date of birth')
      return
    }

    if (!genderValue || genderValue.trim() === '') {
      toast.error('Please select a gender')
      return
    }

    setIsLoading(true)

    interface PatientData {
      name: string
      gender: string
      dob: Date
      isChild: boolean
      isOrtho: boolean
      type: string
      profileImage?: string
      guardianName?: string
      guardianPhone?: string
      guardianEmail?: string
      guardianAddress?: string
      guardianOccupation?: string
      email?: string
      phone?: string
      address?: string
      occupation?: string
      nationality?: string
    }

    const data: PatientData = {
      name: name,
      gender: genderValue,
      dob: new Date(dobValue),
      isChild: isChild,
      isOrtho: typeValue === 'ortho',
      type: typeValue,
      profileImage: profileImageUrl || undefined,
      nationality: nationality || 'Ghana',
    }

    if (isChild) {
      // Child patient - no email, phone, occupation
      data.guardianName = formData.get('guardianName') as string
      data.guardianPhone = phoneValue
      data.guardianEmail = (formData.get('guardianEmail') as string) || undefined
      data.guardianAddress = formData.get('guardianAddress') as string
      data.guardianOccupation = formData.get('guardianOccupation') as string

      if (!data.guardianName || data.guardianName.trim() === '') {
        toast.error("Please enter the guardian's name")
        setIsLoading(false)
        return
      }
      if (!data.guardianAddress || data.guardianAddress.trim() === '') {
        toast.error("Please enter the guardian's address")
        setIsLoading(false)
        return
      }
      if (!data.guardianOccupation || data.guardianOccupation.trim() === '') {
        toast.error("Please enter the guardian's occupation")
        setIsLoading(false)
        return
      }
    } else {
      // Adult patient
      // data.email = (formData.get('email') as string) || undefined
      data.phone = phoneValue
      data.address = formData.get('address') as string
      data.occupation = formData.get('occupation') as string

      if (!data.address || data.address.trim() === '') {
        toast.error('Please enter the address')
        setIsLoading(false)
        return
      }
      if (!data.occupation || data.occupation.trim() === '') {
        toast.error('Please enter the occupation')
        setIsLoading(false)
        return
      }
    }

    const result = await createPatient(data)

    setIsLoading(false)

    if (result.success) {
      // Reset form state
      setIsChild(false)
      setProfileImageUrl(null)
      setCurrentStep(1)
      setGender('')
      setPatientType('general')
      setChildName('')
      setChildDob('')

      try {
        const form = event.currentTarget
        if (form) form.reset()
      } catch {
        // Silently ignore form reset errors
      }

      setOpen(false)
      toast.success('Patient created successfully.')
    } else {
      toast.error(result.error || 'Something went wrong.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen)
        if (!newOpen) {
          setIsChild(false)
          setProfileImageUrl(null)
          setCurrentStep(1)
          setGender('')
          setPatientType('general')
          setChildName('')
          setChildDob('')
          setNationality('Ghana')
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Patient
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add Patient</DialogTitle>
            <DialogDescription>
              Enter the patient&apos;s details here. All fields are required except email.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Child Checkbox */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isChild"
                checked={isChild}
                onCheckedChange={(checked) => {
                  setIsChild(checked === true)
                  setCurrentStep(1)
                  setPatientType('general') // Reset patient type when switching child status
                }}
              />
              <Label htmlFor="isChild" className="cursor-pointer">
                Patient is a child
              </Label>
            </div>

            <Separator />

            {/* Profile Image */}
            <AvatarUpload
              entityName={childName || 'patient'}
              onUrlChange={handleImageChange}
              defaultAvatar={profileImageUrl || undefined}
            />

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
                    <div className="space-y-2">
                      <Label htmlFor="type-child">Patient Type</Label>
                      <Select
                        name="type"
                        value={patientType}
                        onValueChange={setPatientType}
                        required
                      >
                        <SelectTrigger id="type-child">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">General</SelectItem>
                          <SelectItem value="ortho">Ortho</SelectItem>
                          <SelectItem value="external">External</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-4">
                    {/* Hidden inputs to preserve step 1 data */}
                    <input type="hidden" name="name" value={childName} />
                    <input type="hidden" name="dob" value={childDob} />
                    <input type="hidden" name="gender" value={gender} />
                    <input type="hidden" name="type" value={patientType} />

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
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dob">DOB</Label>
                    <Input
                      id="dob"
                      name="dob"
                      type="date"
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
                <div className="space-y-2">
                  <Label htmlFor="type-adult">Patient Type</Label>
                  <Select name="type" value={patientType} onValueChange={setPatientType} required>
                    <SelectTrigger id="type-adult">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="ortho">Ortho</SelectItem>
                      <SelectItem value="external">External</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
          <DialogFooter>
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
                  disabled={isLoading}
                  className={isChild && currentStep === 2 ? 'ml-auto' : ''}
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
