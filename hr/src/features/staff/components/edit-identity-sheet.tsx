import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Input,
  Label,
  Separator,
  Switch,
} from '@denel/ui'
import { isValidPhoneNumber } from 'libphonenumber-js'
import { Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { BirthdayPicker } from '@/features/staff/components/birthday-picker'
import { updateStaff } from '@/lib/actions/staff'
import { AvatarCropperDialog } from '@/shared/components/avatar-cropper-dialog'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

/** Minimum shape required by EditIdentitySheet. */
interface StaffRecord {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  profileImage: string | null
  staffType: string
  deviceUserId: string | null
  birthDay: number | null
  birthMonth: number | null
  isClinicalPractitioner: boolean
  receivesCommission: boolean
  hasPayslip: boolean
  tracksAttendance: boolean
  requiresLicense: boolean
  isBreakfastLead: boolean
}

/**
 * Per-section Identity editor.
 *
 * PR-10 — replaces the single full-wizard Edit button with a focused sheet
 * for each Profile sub-tab. Identity captures who the person is (name, photo,
 * contact, attendance ID) plus the capability matrix the system uses to
 * decide what they get (clinical, commission, payslip, attendance tracking,
 * license requirement). Employment + Access live in their own sheets.
 */
export function EditIdentitySheet({
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
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [staffType, setStaffType] = useState<'internal' | 'external'>('internal')
  const [deviceUserId, setDeviceUserId] = useState('')
  // PR-19 — birthday day + month, stored as ints (no year on file).
  const [birthDay, setBirthDay] = useState<number | null>(null)
  const [birthMonth, setBirthMonth] = useState<number | null>(null)
  const [isClinicalPractitioner, setIsClinicalPractitioner] = useState(false)
  const [receivesCommission, setReceivesCommission] = useState(false)
  const [hasPayslip, setHasPayslip] = useState(true)
  const [tracksAttendance, setTracksAttendance] = useState(true)
  const [requiresLicense, setRequiresLicense] = useState(false)
  const [isBreakfastLead, setIsBreakfastLead] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()

  useEffect(() => {
    if (!open) return
    setName(staff.fullName ?? '')
    setEmail(staff.email ?? '')
    setPhone(staff.phone ?? '')
    setAvatarUrl(staff.profileImage ?? null)
    setStaffType((staff.staffType as 'internal' | 'external') ?? 'internal')
    setDeviceUserId(staff.deviceUserId ?? '')
    setBirthDay(staff.birthDay ?? null)
    setBirthMonth(staff.birthMonth ?? null)
    setIsClinicalPractitioner(!!staff.isClinicalPractitioner)
    setReceivesCommission(!!staff.receivesCommission)
    setHasPayslip(staff.hasPayslip ?? true)
    setTracksAttendance(staff.tracksAttendance ?? true)
    setRequiresLicense(!!staff.requiresLicense)
    setIsBreakfastLead(!!staff.isBreakfastLead)
  }, [open, staff])

  const isDirty = useMemo(() => {
    return (
      name !== (staff.fullName ?? '') ||
      email !== (staff.email ?? '') ||
      phone !== (staff.phone ?? '') ||
      avatarUrl !== (staff.profileImage ?? null) ||
      staffType !== ((staff.staffType as 'internal' | 'external') ?? 'internal') ||
      deviceUserId !== (staff.deviceUserId ?? '') ||
      birthDay !== (staff.birthDay ?? null) ||
      birthMonth !== (staff.birthMonth ?? null) ||
      isClinicalPractitioner !== !!staff.isClinicalPractitioner ||
      receivesCommission !== !!staff.receivesCommission ||
      hasPayslip !== (staff.hasPayslip ?? true) ||
      tracksAttendance !== (staff.tracksAttendance ?? true) ||
      requiresLicense !== !!staff.requiresLicense ||
      isBreakfastLead !== !!staff.isBreakfastLead
    )
  }, [
    staff,
    name,
    email,
    phone,
    avatarUrl,
    staffType,
    deviceUserId,
    birthDay,
    birthMonth,
    isClinicalPractitioner,
    receivesCommission,
    hasPayslip,
    tracksAttendance,
    requiresLicense,
    isBreakfastLead,
  ])

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => onOpenChange(false),
  })

  // PR-13 — file picker opens the crop dialog instead of writing the raw
  // image straight to local state. User positions + zooms + (optionally)
  // rotates before save.
  const [cropperSource, setCropperSource] = useState<File | null>(null)

  function handleAvatarPick() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      setCropperSource(file)
    }
    input.click()
  }

  function handleSubmit() {
    void submit(async () => {
      if (!name.trim()) {
        toast.error('Full name is required.')
        return
      }
      const emailTrimmed = email.trim()
      if (emailTrimmed) {
        const emailResult = z.string().email().safeParse(emailTrimmed)
        if (!emailResult.success) {
          toast.error('Email looks invalid.')
          return
        }
      }
      const phoneTrimmed = phone.trim()
      if (
        phoneTrimmed &&
        !isValidPhoneNumber(phoneTrimmed, 'GH') &&
        !isValidPhoneNumber(phoneTrimmed)
      ) {
        toast.error('Phone number looks invalid.')
        return
      }
      if ((birthDay && !birthMonth) || (!birthDay && birthMonth)) {
        toast.error('Pick both day and month for the birthday, or leave both blank.')
        return
      }
      try {
        const res = await updateStaff(staff.id, {
          fullName: name.trim(),
          email: emailTrimmed || null,
          phone: phoneTrimmed || null,
          profileImage: avatarUrl,
          staffType,
          deviceUserId: deviceUserId.trim() || null,
          birthDay: birthDay ?? null,
          birthMonth: birthMonth ?? null,
          isClinicalPractitioner,
          receivesCommission,
          hasPayslip,
          tracksAttendance,
          requiresLicense,
          isBreakfastLead,
        })
        if (!res.success) {
          surfaceApiError(res, 'Failed to update identity')
          return
        }
        toast.success('Identity updated.')
        onOpenChange(false)
        onSaved()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Unexpected error — please try again.')
      }
    })
  }

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Edit identity"
        description="Name, contact, attendance ID, and the capability flags that drive system behaviour."
        size="md"
        submitLabel="Save changes"
        submitting={isSubmitting}
        submitDisabled={!isDirty}
        onSubmit={handleSubmit}
      >
        <div className="grid gap-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              {avatarUrl ? (
                <AvatarImage src={avatarUrl} alt={name || 'Avatar'} />
              ) : (
                <AvatarFallback className="text-lg">{(name || '?')[0]}</AvatarFallback>
              )}
            </Avatar>
            <div className="space-y-1">
              <Button type="button" variant="outline" size="sm" onClick={handleAvatarPick}>
                <Upload className="mr-2 h-3.5 w-3.5" />
                {avatarUrl ? 'Change photo' : 'Upload photo'}
              </Button>
              {avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAvatarUrl(null)}
                  className="ml-1 text-muted-foreground"
                >
                  Remove
                </Button>
              )}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="edit-name">Full name *</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          {/* PR-14 — staff type select removed. There are no external
              staff anymore; external/visiting clinical providers live in
              the Specialists module. Existing 'external' records continue
              to be handled defensively in the submit payload below. */}
          <div className="space-y-2">
            <Label htmlFor="edit-device-id">Attendance ID</Label>
            <Input
              id="edit-device-id"
              placeholder="e.g. 120"
              value={deviceUserId}
              onChange={(e) => setDeviceUserId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Maps the biometric/RFID reader's User ID to this staff record.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Birthday</Label>
            <BirthdayPicker
              idPrefix="edit-birthday"
              day={birthDay}
              month={birthMonth}
              onDayChange={setBirthDay}
              onMonthChange={setBirthMonth}
            />
            <p className="text-xs text-muted-foreground">
              Day + month only. Powers the upcoming-birthdays widget on the HR overview.
            </p>
          </div>

          <Separator />

          {/* Capability flags */}
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium">Clinical role &amp; capabilities</h4>
              <p className="text-xs text-muted-foreground">
                These flags decide what this staff member shows up in across the system.
              </p>
            </div>
            <CapabilityToggle
              label="Clinical practitioner"
              description="Appears in appointment booking. Auto-enables license tracking."
              checked={isClinicalPractitioner}
              onChange={(v) => {
                setIsClinicalPractitioner(v)
                if (v) setRequiresLicense(true)
              }}
            />
            <CapabilityToggle
              label="Receives commission"
              description="Included in commission payout runs."
              checked={receivesCommission}
              onChange={setReceivesCommission}
            />
            <CapabilityToggle
              label="On payslip"
              description="Included in monthly payroll runs."
              checked={hasPayslip}
              onChange={setHasPayslip}
            />
            <CapabilityToggle
              label="Tracks attendance"
              description="Appears on attendance reports + biometric reader matching."
              checked={tracksAttendance}
              onChange={setTracksAttendance}
            />
            <CapabilityToggle
              label="Requires license"
              description="Credential expiry monitor watches their professional license."
              checked={requiresLicense}
              onChange={setRequiresLicense}
            />
            <CapabilityToggle
              label="Breakfast lead"
              description="Submits the weekly staff breakfast list in the team app."
              checked={isBreakfastLead}
              onChange={setIsBreakfastLead}
            />
          </div>
        </div>
      </SheetFormLayout>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />

      <AvatarCropperDialog
        open={!!cropperSource}
        onOpenChange={(open) => !open && setCropperSource(null)}
        source={cropperSource}
        uploadConfig={{ kind: 'staff', id: staff.id }}
        onCropped={(_blob, _dataUrl, uploadedUrl) => {
          if (!uploadedUrl) {
            toast.error('Photo upload failed — please try again.')
            setCropperSource(null)
            return
          }
          setAvatarUrl(uploadedUrl)
          setCropperSource(null)
        }}
      />
    </>
  )
}

function CapabilityToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}
