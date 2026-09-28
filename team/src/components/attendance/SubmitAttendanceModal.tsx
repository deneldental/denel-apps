import { format } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { staffApi } from '@/lib/api'

/**
 * Fix-request modal. Staff submit a corrected clock-in / clock-out time for a
 * given day; it lands as a pending row that HR reviews under
 * Attendance → Fix Requests. Approving there writes an attendance time override.
 */
export function SubmitAttendanceModal({
  open,
  onOpenChange,
  defaultDate,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate?: string
  onSubmitted?: () => void
}) {
  const [date, setDate] = useState(defaultDate || format(new Date(), 'yyyy-MM-dd'))
  const [punchType, setPunchType] = useState<'clock_in' | 'clock_out'>('clock_in')
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // reset form when modal opens
  useEffect(() => {
    if (open) {
      setDate(defaultDate || format(new Date(), 'yyyy-MM-dd'))
      setPunchType('clock_in')
      setTime('')
      setReason('')
    }
  }, [open, defaultDate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!date || !time) {
      toast.error('Date and time are required')
      return
    }
    setSubmitting(true)
    const res = await staffApi.submitAttendance({ date, punchType, time, reason })
    setSubmitting(false)
    if (res.success) {
      toast.success('Fix request submitted for review')
      onSubmitted?.()
      onOpenChange(false)
    } else {
      toast.error(res.error || 'Failed to submit')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Attendance Fix</DialogTitle>
          <DialogDescription>
            Submit your correct clock in or clock out time. This is reviewed by HR before your
            record is updated.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              max={format(new Date(), 'yyyy-MM-dd')}
            />
          </div>
          <div className="space-y-2">
            <Label>Punch Type</Label>
            <Select
              value={punchType}
              onValueChange={(v: 'clock_in' | 'clock_out') => setPunchType(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clock_in">Clock In</SelectItem>
                <SelectItem value="clock_out">Clock Out</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Time</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you requesting this fix?"
              className="resize-none"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
