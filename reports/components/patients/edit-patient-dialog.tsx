import { isValidPhoneNumber } from 'libphonenumber-js'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { updatePatient } from '@/lib/actions/patients'
import type { patients } from '@/lib/db/schema'

type Patient = typeof patients.$inferSelect

const NOW = new Date()

interface EditPatientDialogProps {
  patient: Patient
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditPatientDialog({ patient, open, onOpenChange }: EditPatientDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isChild, setIsChild] = useState(patient.isChild || false)
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(
    patient.profileImage || null
  )

  // State for fields
  const [name, setName] = useState(patient.name)
  const [dob, setDob] = useState(
    patient.dob ? new Date(patient.dob).toISOString().split('T')[0] : ''
  )
  const [gender, setGender] = useState(patient.gender)
  const [type, setType] = useState(patient.type || 'general')
  const [phone, setPhone] = useState(patient.phone || '')
  const [email, setEmail] = useState(patient.email || '')
  const [address, setAddress] = useState(patient.address || '')
  const [occupation, setOccupation] = useState(patient.occupation || '')
  const [nationality, setNationality] = useState(patient.nationality || 'Ghana')

  // Guardian fields
  const [guardianName, setGuardianName] = useState(patient.guardianName || '')
  const [guardianPhone, setGuardianPhone] = useState(patient.guardianPhone || '')
  const [guardianEmail, setGuardianEmail] = useState(patient.guardianEmail || '')
  const [guardianAddress, setGuardianAddress] = useState(patient.guardianAddress || '')
  const [guardianOccupation, setGuardianOccupation] = useState(patient.guardianOccupation || '')

  // Reset state when patient changes or dialog opens
  useEffect(() => {
    if (!open) return

    let active = true

    Promise.resolve().then(() => {
      if (!active) return

      setIsChild(patient.isChild || false)
      setProfileImageUrl(patient.profileImage || null)
      setName(patient.name)
      setDob(patient.dob ? new Date(patient.dob).toISOString().split('T')[0] : '')
      setGender(patient.gender)
      setType(patient.type || 'general')
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
    })

    return () => {
      active = false
    }
  }, [patient, open])

  const calculateAge = (dobString: string) => {
    if (!dobString) return null
    const dobDate = new Date(dobString)
    const diff = NOW.getTime() - dobDate.getTime()
    const ageDate = new Date(diff)
    return Math.abs(ageDate.getUTCFullYear() - 1970)
  }

  const handleImageChange = (url: string | null) => {
    setProfileImageUrl(url)
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    // Validation
    if (!name || name.trim() === '') {
      toast.error("Please enter the patient's name")
      setIsLoading(false)
      return
    }

    const phoneToValidate = isChild ? guardianPhone : phone
    if (!phoneToValidate || phoneToValidate.trim() === '') {
      toast.error(
        isChild ? "Please enter the guardian's phone number" : 'Please enter the phone number'
      )
      setIsLoading(false)
      return
    }

    if (phoneToValidate && !isValidPhoneNumber(phoneToValidate, 'GH')) {
      if (!phoneToValidate.startsWith('+') && !isValidPhoneNumber(phoneToValidate, 'GH')) {
        toast.error('Please enter a valid phone number')
        setIsLoading(false)
        return
      }
    }

    if (!dob) {
      toast.error('Please enter the date of birth')
      setIsLoading(false)
      return
    }

    interface PatientUpdateInput {
      name: string
      dob: Date
      gender: string
      type: string
      isChild: boolean
      isOrtho: boolean
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
    }

    const data: PatientUpdateInput = {
      name,
      dob: new Date(dob),
      gender,
      type,
      isChild,
      isOrtho: type === 'ortho',
      profileImage: profileImageUrl,
      nationality,
    }

    if (isChild) {
      data.guardianName = guardianName
      data.guardianPhone = guardianPhone
      data.guardianEmail = guardianEmail
      data.guardianAddress = guardianAddress
      data.guardianOccupation = guardianOccupation

      // Clear adult fields just in case
      data.phone = null
      data.email = null
      data.address = null
      data.occupation = null

      if (!guardianName) {
        toast.error('Guardian name is required')
        setIsLoading(false)
        return
      }
    } else {
      data.phone = phone
      data.email = email
      data.address = address
      data.occupation = occupation

      // Clear guardian fields
      data.guardianName = null
      data.guardianPhone = null
      data.guardianEmail = null
      data.guardianAddress = null
      data.guardianOccupation = null

      if (!address) {
        toast.error('Address is required')
        setIsLoading(false)
        return
      }
    }

    const result = await updatePatient(patient.id, data)

    setIsLoading(false)

    if (result.success) {
      toast.success('Patient updated successfully')
      onOpenChange(false)
    } else {
      toast.error(result.error || 'Failed to update patient')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Patient</DialogTitle>
            <DialogDescription>
              Make changes to the patient&apos;s profile here. Click save when you&apos;re done.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
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
              onUrlChange={handleImageChange}
              defaultAvatar={profileImageUrl || undefined}
            />

            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-dob">Date of Birth</Label>
                <Input
                  id="edit-dob"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Age</Label>
                <Input value={calculateAge(dob) ?? ''} disabled readOnly className="bg-muted" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-gender">Gender</Label>
                <Select value={gender} onValueChange={setGender} required>
                  <SelectTrigger id="edit-gender">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-type">Patient Type</Label>
                <Select value={type} onValueChange={setType} required>
                  <SelectTrigger id="edit-type">
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

            <div className="space-y-2">
              <Label htmlFor="edit-nationality">Nationality</Label>
              <Input
                id="edit-nationality"
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                placeholder="Ghana"
              />
            </div>

            {isChild ? (
              <div className="space-y-4 border rounded-md p-4 bg-muted/20">
                <h4 className="font-medium text-sm text-muted-foreground">Guardian Information</h4>
                <div className="space-y-2">
                  <Label htmlFor="edit-guardianName">Guardian Name</Label>
                  <Input
                    id="edit-guardianName"
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-guardianPhone">Guardian Phone</Label>
                  <Input
                    id="edit-guardianPhone"
                    value={guardianPhone}
                    onChange={(e) => setGuardianPhone(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-guardianOccupation">Guardian Occupation</Label>
                  <Input
                    id="edit-guardianOccupation"
                    value={guardianOccupation}
                    onChange={(e) => setGuardianOccupation(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-guardianAddress">Guardian Address</Label>
                  <Input
                    id="edit-guardianAddress"
                    value={guardianAddress}
                    onChange={(e) => setGuardianAddress(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-guardianEmail">Guardian Email (Optional)</Label>
                  <Input
                    id="edit-guardianEmail"
                    type="email"
                    value={guardianEmail}
                    onChange={(e) => setGuardianEmail(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit-phone">Phone</Label>
                  <Input
                    id="edit-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email (Optional)</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-occupation">Occupation</Label>
                  <Input
                    id="edit-occupation"
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-address">Address</Label>
                  <Input
                    id="edit-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    required
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
