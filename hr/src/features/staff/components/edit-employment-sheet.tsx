import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@denel/ui'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getStaffLeaveBalance, type LeaveBalance, updateStaff } from '@/lib/actions/staff'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO } from '@/shared/lib/dates'
import { PerStaffOffDays } from './per-staff-off-days'

type EmploymentType = 'permanent' | 'contract' | 'external_trainer' | 'intern' | 'consultant'

type EmployeeCategory = 'standard' | 'qje'

interface StaffRecord {
  id: string
  position: string | null
  employmentType: string | null
  dateOfJoining: string | Date | null
  ssnitId: string | null
  annualLeaveEntitlement: number | null
  employeeCategory: string | null
}

/**
 * Per-section Employment editor.
 *
 * PR-10 — captures position, employment type, dates, SSNIT ID
 * (new), and emergency contact.
 *
 * PR-11 — clinic tag (positionTag) moved out of this sheet and into the
 * Access edit sheet, since it's an access-control concern (drives PWA bundle
 * auto-grant), not an employment record concern.
 *
 * Emergency contact moved out to the Personal sheet — it's personal data, not
 * an employment term, and the `emergencyContactRelationship` field only ever
 * existed there, so the triple was half-editable while it lived here.
 */
export function EditEmploymentSheet({
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
  const [position, setPosition] = useState('')
  const [employmentType, setEmploymentType] = useState<EmploymentType>('permanent')
  const [dateOfJoining, setDateOfJoining] = useState('')
  const [ssnitId, setSsnitId] = useState('')
  // PR-19 — per-staff annual leave entitlement override. Empty input means
  // "use the clinic-wide default" (stored as a clinic_settings KV row).
  const [annualLeaveEntitlement, setAnnualLeaveEntitlement] = useState('')
  // GRA overtime tax treatment — read by the automated payroll run to apply the
  // QJE 5%/10% overtime concession instead of taxing overtime as PAYE income.
  const [employeeCategory, setEmployeeCategory] = useState<EmployeeCategory>('standard')
  const { isSubmitting, submit } = useSubmitGuard()
  // PR-21 — annual leave balance summary. Refetched on every open + after
  // a successful save so changing the entitlement updates the chip live.
  const [balance, setBalance] = useState<LeaveBalance | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setPosition(staff.position ?? '')
    setEmploymentType((staff.employmentType as EmploymentType) ?? 'permanent')
    setDateOfJoining(staff.dateOfJoining ? localDateISO(new Date(staff.dateOfJoining)) : '')
    setSsnitId(staff.ssnitId ?? '')
    setAnnualLeaveEntitlement(
      staff.annualLeaveEntitlement === null || staff.annualLeaveEntitlement === undefined
        ? ''
        : String(staff.annualLeaveEntitlement)
    )
    setEmployeeCategory((staff.employeeCategory as EmployeeCategory) ?? 'standard')
    // Load the balance lazily — failures here aren't fatal to the form.
    setBalanceLoading(true)
    void getStaffLeaveBalance(staff.id).then((res) => {
      if (res.success && res.data) setBalance(res.data)
      else setBalance(null)
      setBalanceLoading(false)
    })
  }, [open, staff])

  const isDirty = useMemo(() => {
    const initialJoining = staff.dateOfJoining ? localDateISO(new Date(staff.dateOfJoining)) : ''
    const initialEntitlement =
      staff.annualLeaveEntitlement === null || staff.annualLeaveEntitlement === undefined
        ? ''
        : String(staff.annualLeaveEntitlement)
    return (
      position !== (staff.position ?? '') ||
      employmentType !== ((staff.employmentType as EmploymentType) ?? 'permanent') ||
      dateOfJoining !== initialJoining ||
      ssnitId !== (staff.ssnitId ?? '') ||
      annualLeaveEntitlement !== initialEntitlement ||
      employeeCategory !== ((staff.employeeCategory as EmployeeCategory) ?? 'standard')
    )
  }, [
    staff,
    position,
    employmentType,
    dateOfJoining,
    ssnitId,
    annualLeaveEntitlement,
    employeeCategory,
  ])

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => onOpenChange(false),
  })

  function handleSubmit() {
    void submit(async () => {
      if (dateOfJoining && Number.isNaN(new Date(dateOfJoining).getTime())) {
        toast.error('Date of joining is not a valid date.')
        return
      }
      let entitlementPayload: number | null = null
      if (annualLeaveEntitlement.trim()) {
        const parsed = Number(annualLeaveEntitlement)
        if (!Number.isInteger(parsed) || parsed < 0) {
          toast.error('Annual leave entitlement must be a whole number of days (0 or more).')
          return
        }
        entitlementPayload = parsed
      }
      const res = await updateStaff(staff.id, {
        position: position.trim() || null,
        employmentType,
        dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : null,
        ssnitId: ssnitId.trim() || null,
        annualLeaveEntitlement: entitlementPayload,
        employeeCategory,
      })
      if (!res.success) {
        surfaceApiError(res, 'Failed to update employment')
        return
      }
      toast.success('Employment updated.')
      onSaved()
      onOpenChange(false)
    })
  }

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Edit employment"
        description="Position, contract, payroll IDs, and emergency contact."
        size="md"
        submitLabel="Save changes"
        submitting={isSubmitting}
        submitDisabled={!isDirty}
        onSubmit={handleSubmit}
      >
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-position">Position</Label>
              <Input
                id="edit-position"
                placeholder="e.g. Dental Hygienist"
                maxLength={100}
                value={position}
                onChange={(e) => setPosition(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-emp-type">Employment type</Label>
              <Select
                value={employmentType}
                onValueChange={(v) => setEmploymentType(v as EmploymentType)}
              >
                <SelectTrigger id="edit-emp-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="permanent">Permanent</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="intern">Intern</SelectItem>
                  <SelectItem value="consultant">Consultant</SelectItem>
                  <SelectItem value="external_trainer">External trainer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-doj">Date of joining</Label>
              <Input
                id="edit-doj"
                type="date"
                value={dateOfJoining}
                onChange={(e) => setDateOfJoining(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-ssnit">SSNIT ID</Label>
              <Input
                id="edit-ssnit"
                placeholder="e.g. C12345678901"
                maxLength={20}
                value={ssnitId}
                onChange={(e) => setSsnitId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Required for payroll/tax processing — backfill once HR has it.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-emp-category">Overtime tax treatment</Label>
              <Select
                value={employeeCategory}
                onValueChange={(v) => setEmployeeCategory(v as EmployeeCategory)}
              >
                <SelectTrigger id="edit-emp-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard (overtime → PAYE)</SelectItem>
                  <SelectItem value="qje">QJE — junior concession (5%/10%)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                QJE taxes overtime at 5% up to half of basic, then 10% — a final tax outside PAYE.
                Payroll runs use this per staff.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-leave-entitlement">Annual leave entitlement (days/year)</Label>
            <Input
              id="edit-leave-entitlement"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="Leave blank for clinic default"
              value={annualLeaveEntitlement}
              onChange={(e) => setAnnualLeaveEntitlement(e.target.value)}
              className="max-w-[200px]"
            />
            <p className="text-xs text-muted-foreground">
              Override the clinic-wide default for this staff. Used by the leave request flow.
            </p>
            {balanceLoading && <div className="mt-2 h-6 w-48 animate-pulse rounded-md bg-muted" />}
            {!balanceLoading && balance && (
              <div className="mt-2 space-y-1.5">
                <div className="inline-flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1 text-xs">
                  <span className="font-medium tabular-nums">
                    {balance.remaining}/{balance.entitlement} days remaining
                  </span>
                  <span className="text-muted-foreground">
                    · {balance.used} used in {balance.year}
                  </span>
                  {balance.source === 'clinic_default' && (
                    <span className="text-muted-foreground italic">(clinic default)</span>
                  )}
                </div>
                {balance.split && (
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5">
                      <span className="font-medium">Annual Leave</span>
                      <span className="text-muted-foreground">(single block)</span>
                      <span className="tabular-nums text-muted-foreground">
                        {balance.split.annualRemaining}/{balance.split.annualQuota} left
                      </span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${
                        balance.split.casualExhausted ? 'border-amber-400/60 bg-amber-50/50' : ''
                      }`}
                    >
                      <span className="font-medium">Casual Leave</span>
                      <span className="text-muted-foreground">(in bits)</span>
                      <span className="tabular-nums text-muted-foreground">
                        {balance.split.casualRemaining}/{balance.split.casualQuota} left
                      </span>
                      {balance.split.casualExhausted && (
                        <span className="text-amber-700">· override needed</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Off-days</Label>
            <PerStaffOffDays staffId={staff.id} />
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
