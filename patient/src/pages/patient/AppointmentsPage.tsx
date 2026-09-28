import {
  AlertCircle,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'

interface Appointment {
  id: string
  date: string
  type: string
  status: string
  durationMinutes: number
  notes: string | null
  doctor: { user: { name: string } }
}

interface BookingRequest {
  id: string
  requestType: 'new' | 'reschedule' | 'cancellation'
  preferredDate: string | null
  preferredTime: string | null
  service: string | null
  message: string | null
  status: string
  relatedAppointmentId: string | null
  /** Reason the clinic gave when cancelling this request (shown to the patient). */
  cancellationReason: string | null
  createdAt: string
}

const STATUS_COLOR: Record<string, string> = {
  scheduled: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
  confirmed: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
  checked_in: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20',
  in_chair: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20',
  completed: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20',
  cancelled: 'text-red-500 bg-red-50 dark:bg-red-900/20',
  no_show: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20',
  'no-show': 'text-orange-500 bg-orange-50 dark:bg-orange-900/20',
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  scheduled: <Calendar className="h-4 w-4" />,
  confirmed: <Calendar className="h-4 w-4" />,
  checked_in: <Calendar className="h-4 w-4" />,
  in_chair: <Calendar className="h-4 w-4" />,
  completed: <CheckCircle2 className="h-4 w-4" />,
  cancelled: <XCircle className="h-4 w-4" />,
  no_show: <AlertCircle className="h-4 w-4" />,
  'no-show': <AlertCircle className="h-4 w-4" />,
}

// Mock 9:00-17:00 slot list in 30-min increments
const MOCK_SLOTS = (() => {
  const out: string[] = []
  for (let h = 9; h <= 17; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`)
    if (h !== 17) out.push(`${String(h).padStart(2, '0')}:30`)
  }
  return out
})()

export default function PatientAppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [requests, setRequests] = useState<BookingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'list' | 'new-request'>('list')

  const [reschedTarget, setReschedTarget] = useState<Appointment | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null)
  const [cancelReqTarget, setCancelReqTarget] = useState<BookingRequest | null>(null)
  const [apptTab, setApptTab] = useState<'approved' | 'cancelled'>('approved')
  const [approvedVisible, setApprovedVisible] = useState(5)
  const [cancelledVisible, setCancelledVisible] = useState(5)

  const load = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true)
    try {
      const [apptsRes, reqsRes] = await Promise.all([
        api.get<Appointment[]>('/api/patient-portal/appointments'),
        api.get<BookingRequest[]>('/api/patient-portal/appointment-requests'),
      ])
      if (signal?.cancelled) return
      if (apptsRes.success && Array.isArray(apptsRes.data)) setAppointments(apptsRes.data)
      if (reqsRes.success && Array.isArray(reqsRes.data)) setRequests(reqsRes.data)
    } finally {
      if (!signal?.cancelled) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => {
      signal.cancelled = true
    }
  }, [load])

  const pendingRequests = requests.filter((r) => r.status === 'new' || r.status === 'contacted')
  // Clinic-cancelled requests carry a reason to show the patient. (Patient
  // self-cancellations are deleted, so a cancelled row here = clinic action.)
  const cancelledRequests = requests.filter((r) => r.status === 'cancelled' && r.cancellationReason)

  const CANCELLED_STATUSES = ['cancelled', 'no_show', 'no-show']
  const now = Date.now()
  // Approved = real (non-cancelled) appointments. Upcoming soonest-first, then
  // past most-recent-first.
  const approvedAppts = appointments
    .filter((a) => !CANCELLED_STATUSES.includes(a.status))
    .sort((a, b) => {
      const ta = new Date(a.date).getTime()
      const tb = new Date(b.date).getTime()
      const aUp = ta >= now
      const bUp = tb >= now
      if (aUp !== bUp) return aUp ? -1 : 1
      return aUp ? ta - tb : tb - ta
    })
  const cancelledAppts = appointments
    .filter((a) => CANCELLED_STATUSES.includes(a.status))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const cancelledCount = cancelledAppts.length + cancelledRequests.length
  const isUpcomingActive = (a: Appointment) =>
    new Date(a.date).getTime() >= now && ['scheduled', 'confirmed'].includes(a.status)

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (mode === 'new-request') {
    return (
      <RequestForm
        onCancel={() => setMode('list')}
        onSaved={() => {
          setMode('list')
          load()
        }}
      />
    )
  }

  return (
    <div className="p-5 pb-8 space-y-6">
      <div className="pt-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Appointments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your scheduled and past visits</p>
        </div>
        <Button size="sm" onClick={() => setMode('new-request')}>
          <Plus className="mr-1 h-4 w-4" />
          Request
        </Button>
      </div>

      {/* Pending approval — above the tabs; 5 visible, the rest in an accordion */}
      {pendingRequests.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pending approval
            </h2>
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-100 px-1 text-[10px] font-bold text-amber-700">
              {pendingRequests.length}
            </span>
          </div>
          {pendingRequests.slice(0, 5).map((r) => (
            <PendingRequestCard key={r.id} r={r} onCancel={() => setCancelReqTarget(r)} />
          ))}
          {pendingRequests.length > 5 && (
            <Accordion type="single" collapsible>
              <AccordionItem value="more" className="border-none">
                <AccordionTrigger className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:no-underline">
                  <span className="flex items-center gap-2">
                    Show {pendingRequests.length - 5} more
                    <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-200 px-1 text-[10px] font-bold text-amber-800">
                      {pendingRequests.length - 5}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pt-2">
                  {pendingRequests.slice(5).map((r) => (
                    <PendingRequestCard key={r.id} r={r} onCancel={() => setCancelReqTarget(r)} />
                  ))}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </section>
      )}

      {/* Approved | Cancelled tabs */}
      <div className="flex gap-2 rounded-xl bg-muted/50 p-1">
        <button
          type="button"
          onClick={() => setApptTab('approved')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            apptTab === 'approved'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground'
          }`}
        >
          Approved {approvedAppts.length > 0 && `(${approvedAppts.length})`}
        </button>
        <button
          type="button"
          onClick={() => setApptTab('cancelled')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            apptTab === 'cancelled'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground'
          }`}
        >
          Cancelled {cancelledCount > 0 && `(${cancelledCount})`}
        </button>
      </div>

      {apptTab === 'approved' &&
        (approvedAppts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">No appointments yet</p>
            <p className="text-xs text-muted-foreground/70">
              {pendingRequests.length > 0
                ? 'Your request above is awaiting confirmation.'
                : 'Use “Request” above to ask for an appointment.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {approvedAppts.slice(0, approvedVisible).map((a) => (
              <AppointmentCard
                key={a.id}
                appt={a}
                onReschedule={isUpcomingActive(a) ? () => setReschedTarget(a) : undefined}
                onCancel={isUpcomingActive(a) ? () => setCancelTarget(a) : undefined}
              />
            ))}
            {approvedAppts.length > approvedVisible && (
              <LoadMoreButton onClick={() => setApprovedVisible((v) => v + 5)} />
            )}
          </div>
        ))}

      {apptTab === 'cancelled' &&
        (cancelledCount === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <XCircle className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">Nothing cancelled</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cancelledRequests.map((r) => (
              <CancelledRequestCard key={r.id} r={r} />
            ))}
            {cancelledAppts.slice(0, cancelledVisible).map((a) => (
              <AppointmentCard key={a.id} appt={a} />
            ))}
            {cancelledAppts.length > cancelledVisible && (
              <LoadMoreButton onClick={() => setCancelledVisible((v) => v + 5)} />
            )}
          </div>
        ))}

      <RescheduleSheet
        appt={reschedTarget}
        onClose={() => setReschedTarget(null)}
        onSuccess={load}
      />
      <CancelDialog appt={cancelTarget} onClose={() => setCancelTarget(null)} onSuccess={load} />
      <CancelRequestDialog
        request={cancelReqTarget}
        onClose={() => setCancelReqTarget(null)}
        onSuccess={load}
      />
    </div>
  )
}

function PendingRequestCard({ r, onCancel }: { r: BookingRequest; onCancel: () => void }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium capitalize">{r.requestType} request</p>
          <p className="text-xs text-muted-foreground">
            Sent {new Date(r.createdAt).toLocaleDateString()}
            {r.preferredDate &&
              ` · Preferred: ${r.preferredDate}${r.preferredTime ? ` ${r.preferredTime}` : ''}`}
            {' · '}
            <span className="capitalize">{r.status}</span>
          </p>
          {r.message && <p className="mt-1 text-xs text-muted-foreground">"{r.message}"</p>}
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel request"
          className="shrink-0 rounded-full p-1.5 text-amber-700/70 transition-colors hover:bg-amber-100 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function CancelledRequestCard({ r }: { r: BookingRequest }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
      <div className="flex items-start gap-2">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium capitalize">{r.requestType} request</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Reason: <span className="text-foreground">{r.cancellationReason}</span>
          </p>
        </div>
      </div>
    </div>
  )
}

function LoadMoreButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-border bg-card py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
    >
      Load more
    </button>
  )
}

function AppointmentCard({
  appt,
  onReschedule,
  onCancel,
}: {
  appt: Appointment
  onReschedule?: () => void
  onCancel?: () => void
}) {
  const colorClass = STATUS_COLOR[appt.status] ?? 'text-muted-foreground bg-muted/50'
  const icon = STATUS_ICON[appt.status] ?? <Calendar className="h-4 w-4" />
  const canModify = Boolean(onReschedule && onCancel)

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold capitalize">{appt.type.replace('_', ' ')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Dr. {appt.doctor?.user?.name}</p>
        </div>
        <div
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${colorClass}`}
        >
          {icon}
          <span className="capitalize">{appt.status.replace('_', ' ')}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Calendar className="h-3.5 w-3.5" />
        <span>
          {new Date(appt.date).toLocaleDateString('en-GH', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
          {' · '}
          {new Date(appt.date).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {appt.notes && (
        <p className="mt-2 text-xs text-muted-foreground border-t border-border pt-2">
          {appt.notes}
        </p>
      )}
      {canModify && (
        <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={onReschedule}>
            <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
            Reschedule
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-destructive"
            onClick={onCancel}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Reschedule sheet ───────────────────────────────────────────────────────
function RescheduleSheet({
  appt,
  onClose,
  onSuccess,
}: {
  appt: Appointment | null
  onClose: () => void
  onSuccess?: () => void
}) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset form when the target changes
  useEffect(() => {
    if (appt) {
      setDate('')
      setTime('')
      setReason('')
    }
  }, [appt])

  const slots = useMemo(() => MOCK_SLOTS, [])

  async function submit() {
    if (!appt) return
    setSubmitting(true)
    const res = await api.post('/api/patient-portal/appointment-request', {
      requestType: 'reschedule',
      relatedAppointmentId: appt.id,
      preferredDate: date || null,
      preferredTime: time || null,
      message: reason || null,
    })
    setSubmitting(false)
    if (res.success) {
      toast.success('Reschedule request submitted')
      onClose()
      onSuccess?.()
    } else {
      toast.error((res.error as string) || 'Failed to submit request')
    }
  }

  return (
    <Sheet open={!!appt} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Request reschedule</SheetTitle>
          <SheetDescription>Reception will confirm or propose alternatives.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label>Preferred date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Preferred time</Label>
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger>
                <SelectValue placeholder="Select a slot…" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {slots.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why do you need to reschedule?"
            />
          </div>

          <div className="pt-2 flex items-center gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
              Back
            </Button>
            <Button className="flex-1" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Submit request
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Cancel confirmation ────────────────────────────────────────────────────
function CancelDialog({
  appt,
  onClose,
  onSuccess,
}: {
  appt: Appointment | null
  onClose: () => void
  onSuccess?: () => void
}) {
  const [submitting, setSubmitting] = useState(false)

  async function confirm() {
    if (!appt) return
    setSubmitting(true)
    const res = await api.post('/api/patient-portal/appointment-request', {
      requestType: 'cancellation',
      relatedAppointmentId: appt.id,
    })
    setSubmitting(false)
    if (res.success) {
      toast.success('Cancellation request submitted')
      onClose()
      onSuccess?.()
    } else {
      toast.error((res.error as string) || 'Failed to submit request')
    }
  }

  return (
    <Dialog open={!!appt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel this appointment?</DialogTitle>
          <DialogDescription>
            You will be notified by SMS once the clinic confirms.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting} className="flex-1">
            Keep
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={submitting} className="flex-1">
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Confirm cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Cancel-request confirmation (withdraw a pending request) ────────────────
function CancelRequestDialog({
  request,
  onClose,
  onSuccess,
}: {
  request: BookingRequest | null
  onClose: () => void
  onSuccess?: () => void
}) {
  const [submitting, setSubmitting] = useState(false)

  async function confirm() {
    if (!request) return
    setSubmitting(true)
    const res = await api.delete(`/api/patient-portal/appointment-requests/${request.id}`)
    setSubmitting(false)
    if (res.success) {
      toast.success('Request cancelled')
      onClose()
      onSuccess?.()
    } else {
      toast.error((res.error as string) || 'Failed to cancel request')
    }
  }

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel this request?</DialogTitle>
          <DialogDescription>
            This withdraws your appointment request — the clinic will no longer see it. You can
            submit a new one anytime.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting} className="flex-1">
            Keep
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={submitting} className="flex-1">
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Cancel request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Request form (new-request only) ────────────────────────────────────────
function RequestForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [service, setService] = useState('')
  const [preferredDate, setPreferredDate] = useState('')
  const [preferredTime, setPreferredTime] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Service options come from the clinic's canonical appointment-type lookup so
  // the request converts to a consistent appointment type.
  const [serviceTypes, setServiceTypes] = useState<
    { id: string; name: string; displayName: string | null }[]
  >([])

  useEffect(() => {
    api
      .get<{ id: string; name: string; displayName: string | null }[]>(
        '/api/patient-portal/appointment-types'
      )
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setServiceTypes(res.data)
      })
  }, [])

  async function submit() {
    setSaving(true)
    setError(null)
    const res = await api.post('/api/patient-portal/appointment-request', {
      requestType: 'new',
      service: service || null,
      preferredDate: preferredDate || null,
      preferredTime: preferredTime || null,
      message: message || null,
    })
    setSaving(false)
    if (res.success) {
      onSaved()
    } else {
      setError(res.error || 'Failed to submit request')
    }
  }

  return (
    <div className="p-5 pb-8 space-y-4">
      <div className="pt-4">
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
          ← Back
        </button>
        <h1 className="text-2xl font-bold tracking-tight mt-2">Request appointment</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Reception will contact you to confirm.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Service</Label>
          <Select value={service} onValueChange={setService}>
            <SelectTrigger>
              <SelectValue placeholder="Select a service…" />
            </SelectTrigger>
            <SelectContent>
              {serviceTypes.map((t) => (
                <SelectItem key={t.id} value={t.name}>
                  {t.displayName || t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Preferred Date</Label>
            <Input
              type="date"
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Preferred Time</Label>
            <Input
              type="time"
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Message (optional)</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Anything we should know?"
          />
        </div>

        <div className="pt-2 flex items-center gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Back
          </Button>
          <Button className="flex-1" onClick={submit} disabled={saving}>
            {saving ? 'Sending…' : 'Send Request'}
          </Button>
        </div>

        <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
          Requests are reviewed manually. The clinic will contact you to confirm or propose
          alternatives.
        </p>
      </div>
    </div>
  )
}
