// HR-side "file request for staff" Sheet — mirrors the PWA self-service form:
// pick a category + a configurable subtype (from the shared request-types
// lookup), then dates (leave/permit) or an amount (emergency). Posts to
// /api/staff/leave-requests (HR-on-behalf), which the PWA mirrors at
// /api/staff-portal/requests.

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@denel/ui'
import { CalendarOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  createLeaveRequestForStaff,
  getRequestKinds,
  getRequestSubtypes,
  getStaff,
  getStaffLeaveBalance,
  type LeaveBalance,
  type RequestKind,
  type RequestSubtype,
} from '@/lib/actions/staff'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO } from '@/shared/lib/dates'

type StaffOption = { id: string; fullName: string }

export function FileLeaveSheet({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  onSubmitted: () => void
}) {
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [subtypes, setSubtypes] = useState<RequestSubtype[]>([])
  const [kinds, setKinds] = useState<RequestKind[]>([])
  const [staffId, setStaffId] = useState('')
  const [requestType, setRequestType] = useState<string>('leave')
  const [subType, setSubType] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [balance, setBalance] = useState<LeaveBalance | null>(null)
  const { isSubmitting, submit } = useSubmitGuard()

  // Reset on (re)open.
  useEffect(() => {
    if (!open) return
    setStaffId('')
    setRequestType('leave')
    setSubType('')
    setStartDate('')
    setEndDate('')
    setAmount('')
    setReason('')
    setBalance(null)
  }, [open])

  // Load staff + request subtypes when the sheet opens.
  useEffect(() => {
    if (!open) return
    void getStaff().then((res) => {
      if (res.success && Array.isArray(res.data)) {
        const opts = (res.data as Array<{ id: string; fullName: string }>).map((s) => ({
          id: s.id,
          fullName: s.fullName,
        }))
        opts.sort((a, b) => a.fullName.localeCompare(b.fullName))
        setStaffOptions(opts)
      }
    })
    void getRequestSubtypes().then((res) => {
      if (res.success && Array.isArray(res.data)) setSubtypes(res.data)
    })
    void getRequestKinds().then((res) => {
      if (res.success && Array.isArray(res.data)) setKinds(res.data)
    })
  }, [open])

  // Balance only matters for leave.
  useEffect(() => {
    if (!staffId || requestType !== 'leave') {
      setBalance(null)
      return
    }
    let cancelled = false
    void getStaffLeaveBalance(staffId).then((res) => {
      if (cancelled) return
      setBalance(res.success && res.data ? res.data : null)
    })
    return () => {
      cancelled = true
    }
  }, [staffId, requestType])

  const categorySubtypes = useMemo(
    () => subtypes.filter((s) => s.category === requestType),
    [subtypes, requestType]
  )
  const selectedKind = kinds.find((k) => k.name === requestType)
  const showDates = selectedKind?.showsDates ?? false
  const showAmount = selectedKind?.showsAmount ?? false

  function handleSubmit() {
    void submit(async () => {
      if (!staffId) {
        toast.error('Pick a staff member')
        return
      }
      if (categorySubtypes.length > 0 && !subType) {
        toast.error('Pick a request type')
        return
      }
      if (showDates) {
        if (!startDate || !endDate) {
          toast.error('Pick start and end dates')
          return
        }
        if (startDate < localDateISO()) {
          toast.error('Start date cannot be in the past')
          return
        }
        if (endDate < startDate) {
          toast.error('End date must be on or after the start date')
          return
        }
      }
      const res = await createLeaveRequestForStaff({
        staffId,
        requestType,
        subType: subType || undefined,
        startDate: showDates ? startDate : undefined,
        endDate: showDates ? endDate : undefined,
        amount: showAmount && amount ? Number(amount) : undefined,
        reason: reason.trim() || undefined,
      })
      if (!res.success) {
        surfaceApiError(res, 'Failed to submit request')
        return
      }
      toast.success('Request submitted. Awaiting approval.')
      onOpenChange(false)
      onSubmitted()
    })
  }

  const isDirty = useMemo(
    () => staffId !== '' || subType !== '' || startDate !== '' || endDate !== '' || reason !== '',
    [staffId, subType, startDate, endDate, reason]
  )
  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => onOpenChange(false),
  })

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOnOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CalendarOff className="h-4 w-4" />
              File request for staff
            </SheetTitle>
            <SheetDescription>
              Files a pending request on behalf of a staff member — the same kinds they can submit
              from the app. Approve it from this page once HR is happy.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Staff</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Request</Label>
                <Select
                  value={requestType}
                  onValueChange={(v) => {
                    setRequestType(v)
                    setSubType('')
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kinds.map((k) => (
                      <SelectItem key={k.name} value={k.name}>
                        {k.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select
                  value={subType}
                  onValueChange={setSubType}
                  disabled={categorySubtypes.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorySubtypes.map((s) => (
                      <SelectItem key={s.id} value={s.name}>
                        {s.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {balance && (
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                <span className="font-medium tabular-nums">
                  {balance.remaining}/{balance.entitlement} days remaining
                </span>{' '}
                <span className="text-muted-foreground">
                  · {balance.used} used in {balance.year}
                  {balance.source === 'clinic_default' ? ' (clinic default)' : ''}
                </span>
              </div>
            )}

            {showDates && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="leave-start" className="text-xs">
                    Start date
                  </Label>
                  <Input
                    id="leave-start"
                    type="date"
                    min={localDateISO()}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="leave-end" className="text-xs">
                    End date
                  </Label>
                  <Input
                    id="leave-end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}

            {showAmount && (
              <div className="space-y-1.5">
                <Label htmlFor="req-amount" className="text-xs">
                  Amount (GHS)
                </Label>
                <Input
                  id="req-amount"
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 500"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="leave-reason" className="text-xs">
                Reason (optional)
              </Label>
              <Textarea
                id="leave-reason"
                placeholder="e.g. Family travel"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
              />
            </div>
          </div>

          <SheetFooter className="mt-6 gap-2">
            <Button
              variant="outline"
              onClick={() => guardedOnOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || !staffId}>
              {isSubmitting ? 'Submitting…' : 'Submit request'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
