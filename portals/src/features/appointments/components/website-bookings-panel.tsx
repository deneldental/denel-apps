import { format } from 'date-fns'
import { CalendarPlus, Globe, MoreHorizontal, Search, Smartphone, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { getDoctors } from '@/lib/actions/doctors'
import { getPatient } from '@/lib/actions/patients'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { ScrollArea } from '@/shared/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Textarea } from '@/shared/components/ui/textarea'
import { useLookup } from '@/shared/hooks/use-lookup'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'

// ─── Types ────────────────────────────────────────────────────────────────────

type BookingStatus = 'new' | 'contacted' | 'booked' | 'cancelled'

export type RequestType = 'new' | 'reschedule' | 'cancellation'

export type WebsiteBooking = {
  id: string
  name: string
  email: string | null
  phone: string
  preferredDate: string | null
  preferredTime: string | null
  service: string | null
  message: string | null
  status: BookingStatus
  staffNotes: string | null
  appointmentId: string | null
  createdAt: string
  /** Origin of the request: 'website' (public site) or 'patient_pwa' (patient app). */
  source: string | null
  /** What the patient is asking for. Website bookings are always 'new'. */
  requestType: RequestType | null
  /** For reschedule/cancellation requests — the appointment they refer to. */
  relatedAppointmentId: string | null
  /** Existing patient this request belongs to (patient-app requests only). */
  patientId: string | null
  /** Patient-visible reason recorded when the clinic cancels the request. */
  cancellationReason: string | null
}

type Doctor = { id: string; user?: { name?: string | null } | null }

const STATUS_VARIANTS: Record<
  BookingStatus,
  'default' | 'warning' | 'success' | 'destructive' | 'secondary' | 'outline'
> = {
  new: 'warning',
  contacted: 'secondary',
  booked: 'success',
  cancelled: 'destructive',
}

// ─── Public panel — full management surface, column-friendly layout ──────────

interface Props {
  /** Optional fetched bookings (avoids a duplicate request when the parent
   *  already loaded them for badges). When omitted, the panel fetches on mount. */
  bookings?: WebsiteBooking[]
  loading?: boolean
  onChange?: (bookings: WebsiteBooking[]) => void
  /** Fired after an action that affects the appointments calendar
   *  (notably the "Add to calendar" convert flow). Lets the parent shell
   *  refetch appointments so the new booking shows up on the grid without
   *  a full page reload. */
  onAppointmentChange?: () => void
}

export function WebsiteBookingsPanel({
  bookings: bookingsProp,
  loading: loadingProp,
  onChange,
  onAppointmentChange,
}: Props) {
  const navigate = useNavigate()
  const [internalBookings, setInternalBookings] = useState<WebsiteBooking[]>(bookingsProp ?? [])
  const [internalLoading, setInternalLoading] = useState(!bookingsProp)
  const [search, setSearch] = useState('')
  // Paginate the worklist — reveal 15 at a time. Reset when the search changes.
  const [visible, setVisible] = useState(15)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset page on new search
  useEffect(() => {
    setVisible(15)
  }, [search])

  const bookings = bookingsProp ?? internalBookings
  const loading = loadingProp ?? internalLoading

  const [selected, setSelected] = useState<WebsiteBooking | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const [convertBooking, setConvertBooking] = useState<WebsiteBooking | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  // Shared appointment-type lookup — refreshes when Settings edits it, no reload.
  const { rows: apptTypes } = useLookup('appointment-types')
  const [convertType, setConvertType] = useState('')
  // Ad-hoc patient fields — pre-filled from the booking, editable so the
  // receptionist can correct a typo before the patient record is created.
  const [adhocName, setAdhocName] = useState('')
  const [adhocPhone, setAdhocPhone] = useState('')
  const [selectedDoctorId, setSelectedDoctorId] = useState('')
  const [convertDate, setConvertDate] = useState('')
  const [convertTime, setConvertTime] = useState('')
  const [convertNotes, setConvertNotes] = useState('')
  // [Medium] Used to be a plain useState boolean — useSubmitGuard's own doc
  // comment explicitly calls that insufficient: a `disabled` button alone
  // doesn't stop a re-entrant call before React has flushed the state update.
  const { isSubmitting: converting, submit: submitConvert } = useSubmitGuard()
  // Existing patient a patient-app request belongs to (looked up by patientId).
  const [linkedPatient, setLinkedPatient] = useState<{
    id: string
    name: string
    patientId?: string | null
  } | null>(null)
  // Cancellation-reason dialog (required for patient-app requests).
  const [cancelTarget, setCancelTarget] = useState<WebsiteBooking | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    setInternalLoading(true)
    const res = await api.get<WebsiteBooking[]>('/api/website-bookings')
    if (res.success && res.data) {
      setInternalBookings(res.data)
      onChange?.(res.data)
    }
    setInternalLoading(false)
  }, [onChange])

  useEffect(() => {
    if (bookingsProp === undefined) load()
    // Refresh when the parent-supplied array changes externally.
  }, [bookingsProp, load])

  function openDetail(b: WebsiteBooking) {
    setSelected(b)
    setNotes(b.staffNotes || '')
  }

  async function saveDetail() {
    if (!selected) return
    setSaving(true)
    // Detail sheet only edits internal staff notes — status transitions are
    // controlled by the card actions (Add to calendar / Cancel).
    const res = await api.patch(`/api/website-bookings/${selected.id}`, {
      staffNotes: notes || null,
    })
    setSaving(false)
    if (res.success) {
      toast.success('Notes saved')
      setSelected(null)
      load()
    } else {
      toast.error(res.error || 'Failed to save notes')
    }
  }

  function cancelBooking(booking: WebsiteBooking) {
    if (booking.status === 'cancelled') return
    // Patient-app requests require a reason the patient will see — open the
    // reason dialog. Website bookings can be cancelled directly.
    if (booking.source === 'patient_pwa') {
      setCancelTarget(booking)
      setCancelReason('')
      return
    }
    void doCancel(booking, null)
  }

  async function doCancel(booking: WebsiteBooking, reason: string | null) {
    setCancelling(true)
    const res = await api.patch(`/api/website-bookings/${booking.id}`, {
      status: 'cancelled',
      ...(reason ? { cancellationReason: reason } : {}),
    })
    setCancelling(false)
    if (res.success) {
      toast.success('Request cancelled')
      setCancelTarget(null)
      load()
    } else {
      toast.error(res.error || 'Failed to cancel booking')
    }
  }

  function openReschedule(booking: WebsiteBooking) {
    if (booking.appointmentId) {
      navigate(`/appointments?appointmentId=${booking.appointmentId}`)
      return
    }
    openConvert(booking)
  }

  async function openConvert(booking: WebsiteBooking) {
    if (booking.appointmentId) {
      navigate(`/appointments?appointmentId=${booking.appointmentId}`)
      return
    }
    setConvertBooking(booking)
    setAdhocName(booking.name)
    setAdhocPhone(booking.phone)
    setSelectedDoctorId('')
    setConvertDate(booking.preferredDate || '')
    setConvertTime(booking.preferredTime || '')
    setConvertNotes(booking.message || '')

    // Patient-app request → look up the existing patient so we link it instead
    // of creating a duplicate. Website requests have no patientId.
    if (booking.patientId) {
      const p = await getPatient(booking.patientId)
      setLinkedPatient(
        p.success && p.data
          ? { id: booking.patientId, name: p.data.name, patientId: p.data.patientId }
          : { id: booking.patientId, name: booking.name }
      )
    } else {
      setLinkedPatient(null)
    }

    if (doctors.length === 0) {
      const d = await getDoctors()
      if (d.success && d.data) setDoctors(d.data as Doctor[])
    }

    // Pre-select the appointment type matching the request's service so the
    // converted appointment always carries a valid type. `apptTypes` is the
    // shared lookup (already loaded via useLookup).
    const svc = (booking.service || '').trim().toLowerCase()
    const matched = apptTypes.find(
      (t) => t.name.toLowerCase() === svc || (t.displayName || '').toLowerCase() === svc
    )
    setConvertType(matched?.name ?? '')
  }

  async function handleConvert() {
    if (!convertBooking) return
    // Linked (patient-app) requests skip the ad-hoc name/phone — they reuse the
    // existing patient record.
    if (!linkedPatient) {
      if (!adhocName.trim()) {
        toast.error('Patient name is required')
        return
      }
      if (!adhocPhone.trim()) {
        toast.error('Patient phone is required')
        return
      }
    }
    if (!selectedDoctorId) {
      toast.error('Select a doctor')
      return
    }
    if (!convertType) {
      toast.error('Select an appointment type')
      return
    }
    if (!convertDate) {
      toast.error('Pick a date')
      return
    }
    await submitConvert(async () => {
      const res = await api.post(
        `/api/website-bookings/${convertBooking.id}/convert-to-appointment`,
        {
          // Linked → reuse the existing patient (no duplicate). Else create an
          // ad-hoc patient from name/phone (website bookings).
          ...(linkedPatient
            ? { patientId: linkedPatient.id }
            : { patient: { name: adhocName.trim(), phone: adhocPhone.trim() } }),
          doctorId: selectedDoctorId,
          type: convertType,
          date: convertDate,
          time: convertTime || undefined,
          notes: convertNotes.trim() || undefined,
        }
      )
      if (res.success) {
        toast.success(linkedPatient ? 'Appointment created' : 'Patient + appointment created')
        setConvertBooking(null)
        setLinkedPatient(null)
        load()
        // The new appointment row needs to surface on the calendar grid
        // immediately — without this the receptionist sees nothing change
        // until a manual page refresh.
        onAppointmentChange?.()
      } else {
        toast.error(res.error || 'Failed to create appointment')
      }
    })
  }

  // The Website tab is a worklist of fresh inbound requests, so we only
  // surface bookings that still need triage. Booked rows have been turned
  // into appointments (visible on the calendar); cancelled rows are dead
  // history. Both belong out of the queue.
  const filtered = bookings
    .filter((b) => b.status === 'new' || b.status === 'contacted')
    .filter((b) =>
      `${b.name} ${b.phone} ${b.email || ''}`.toLowerCase().includes(search.toLowerCase())
    )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search bar */}
      <div className="px-4 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search requests…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-xs"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1 min-h-0">
        {loading ? (
          <div className="space-y-2 px-3 py-3">
            {[...Array(4)].map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeletons
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            <Globe className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="font-medium">No requests yet</p>
            <p className="mt-1 text-xs">
              Requests from the website and the patient app will appear here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-muted-foreground">
            No bookings match "{search}".
          </div>
        ) : (
          <div className="px-2 pb-3">
            {filtered.slice(0, visible).map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                onView={() => openDetail(b)}
                onAddToCalendar={() => openConvert(b)}
                onReschedule={() => openReschedule(b)}
                onCancel={() => cancelBooking(b)}
              />
            ))}
            {filtered.length > visible && (
              <button
                type="button"
                onClick={() => setVisible((v) => v + 15)}
                className="mt-2 w-full rounded-lg border border-border bg-card py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
              >
                Show more ({filtered.length - visible})
              </button>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Detail sheet */}
      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent className="!w-full !max-w-[480px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="mb-6">
                <SheetTitle>Booking — {selected.name}</SheetTitle>
              </SheetHeader>

              <div className="space-y-5 pb-6">
                <div className="rounded-lg bg-muted/40 p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Source</span>
                    <SourceTag source={selected.source} />
                  </div>
                  {selected.requestType && selected.requestType !== 'new' && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Request type</span>
                      <span className="font-medium capitalize">{selected.requestType}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="font-medium">{selected.phone}</span>
                  </div>
                  {selected.email && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span>{selected.email}</span>
                    </div>
                  )}
                  {selected.preferredDate && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Preferred date</span>
                      <span>
                        {selected.preferredDate}{' '}
                        {selected.preferredTime && `at ${selected.preferredTime}`}
                      </span>
                    </div>
                  )}
                  {selected.service && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Service</span>
                      <span className="capitalize">{selected.service}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Received</span>
                    <span>{format(new Date(selected.createdAt), 'MMM d, yyyy h:mm a')}</span>
                  </div>
                </div>

                {selected.message && (
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                      Message from patient
                    </Label>
                    <p className="text-sm rounded-lg bg-muted/30 border border-border p-3">
                      {selected.message}
                    </p>
                  </div>
                )}

                <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Booking status is set automatically by the actions on the card — "Add to calendar"
                  flips to <strong>booked</strong>, "Cancel" flips to <strong>cancelled</strong>. No
                  manual status changes here.
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="staff-notes">Staff Notes</Label>
                  <Textarea
                    id="staff-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Internal notes — not visible to patient"
                  />
                </div>
              </div>

              <SheetFooter>
                <Button onClick={saveDetail} disabled={saving} className="w-full">
                  {saving ? 'Saving…' : 'Save Changes'}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Convert-to-appointment sheet — modified appointment form for new
          (non-existing) website-booking patients. The backend auto-creates
          a patient record from name+phone when patientId is omitted, with
          sentinel dob/gender that the receptionist fills in after check-in. */}
      <Sheet open={!!convertBooking} onOpenChange={(v) => !v && setConvertBooking(null)}>
        <SheetContent className="!w-full !max-w-[480px] overflow-y-auto">
          {convertBooking && (
            <>
              <SheetHeader className="mb-6">
                <SheetTitle>Add to calendar — {convertBooking.name}</SheetTitle>
              </SheetHeader>

              <div className="space-y-5 pb-6">
                {linkedPatient ? (
                  /* Patient-app request → link the existing patient (no duplicate). */
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-950/10">
                    <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                      <Smartphone className="h-3.5 w-3.5" />
                      <span className="font-medium">Existing patient</span>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold">{linkedPatient.name}</p>
                    {linkedPatient.patientId && (
                      <p className="font-mono text-xs text-muted-foreground">
                        {linkedPatient.patientId}
                      </p>
                    )}
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      This request came from the patient app — the appointment links to their
                      existing record, no new patient is created.
                    </p>
                  </div>
                ) : (
                  /* Website request — ad-hoc patient, editable so the receptionist
                     can correct a typo before the record is created. */
                  <div className="rounded-lg border border-dashed border-orange-300 bg-orange-50/40 dark:bg-orange-950/10 p-3 space-y-3">
                    <div className="flex items-start gap-2 text-xs text-orange-700 dark:text-orange-400">
                      <span className="font-medium">New patient</span>
                      <span className="text-orange-600/70 dark:text-orange-400/70">
                        A patient record will be created from these fields. The receptionist can
                        complete the full profile (DOB, gender, etc.) after check-in.
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="adhoc-name">Patient name *</Label>
                      <Input
                        id="adhoc-name"
                        value={adhocName}
                        onChange={(e) => setAdhocName(e.target.value)}
                        placeholder="Full name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="adhoc-phone">Phone *</Label>
                      <Input
                        id="adhoc-phone"
                        value={adhocPhone}
                        onChange={(e) => setAdhocPhone(e.target.value)}
                        placeholder="Patient phone"
                        type="tel"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Only the name + phone go onto the patient record. Email and the rest of the
                      profile (DOB, gender, address…) are filled in after check-in.
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Doctor *</Label>
                  <Select value={selectedDoctorId} onValueChange={setSelectedDoctorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select doctor…" />
                    </SelectTrigger>
                    <SelectContent>
                      {doctors.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.user?.name || 'Unknown'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Appointment type *</Label>
                  <Select value={convertType} onValueChange={setConvertType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {apptTypes.map((t) => (
                        <SelectItem key={t.id} value={t.name}>
                          {t.displayName || t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {convertBooking.service &&
                    !apptTypes.some(
                      (t) =>
                        t.name.toLowerCase() === convertBooking.service?.trim().toLowerCase() ||
                        (t.displayName || '').toLowerCase() ===
                          convertBooking.service?.trim().toLowerCase()
                    ) && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">
                        Requested “{convertBooking.service}” isn’t a standard type — pick the
                        closest match.
                      </p>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="convert-date">Date *</Label>
                    <Input
                      id="convert-date"
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={convertDate}
                      onChange={(e) => setConvertDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="convert-time">Time</Label>
                    <Input
                      id="convert-time"
                      type="time"
                      value={convertTime}
                      onChange={(e) => setConvertTime(e.target.value)}
                    />
                  </div>
                </div>

                {convertBooking.service && (
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                    <span className="text-muted-foreground">Requested service: </span>
                    <span className="font-medium capitalize">{convertBooking.service}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="convert-notes">Notes</Label>
                  <Textarea
                    id="convert-notes"
                    rows={3}
                    value={convertNotes}
                    onChange={(e) => setConvertNotes(e.target.value)}
                    placeholder="Pre-filled with the patient's booking message — edit as needed"
                  />
                </div>
              </div>

              <SheetFooter>
                <Button onClick={handleConvert} disabled={converting} className="w-full">
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  {converting ? 'Creating…' : 'Create patient + appointment'}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Cancel-reason dialog — required for patient-app requests; the reason is
          shown to the patient in their app. */}
      <Dialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel this request?</DialogTitle>
            <DialogDescription>
              This came from the patient app. Give a reason — the patient will see it as the reason
              for cancellation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason *</Label>
            <Textarea
              id="cancel-reason"
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. The requested slot is unavailable — please pick another time."
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={cancelling || !cancelReason.trim()}
              onClick={() => cancelTarget && doCancel(cancelTarget, cancelReason.trim())}
            >
              {cancelling ? 'Cancelling…' : 'Cancel request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Source tag (Website vs Patient app) ─────────────────────────────────────
function SourceTag({ source }: { source: string | null }) {
  const isPatientApp = source === 'patient_pwa'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ${
        isPatientApp
          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
          : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
      }`}
    >
      {isPatientApp ? <Smartphone className="h-2.5 w-2.5" /> : <Globe className="h-2.5 w-2.5" />}
      {isPatientApp ? 'Patient app' : 'Website'}
    </span>
  )
}

// ─── Booking card (vertical, column-friendly) ────────────────────────────────
// Action surface intentionally lean: Add-to-calendar / Reschedule / Cancel.
// Status transitions happen as side-effects of the real actions — Cancel sets
// status='cancelled', Add-to-calendar sets status='booked'. No manual flips.

function BookingCard({
  booking,
  onView,
  onAddToCalendar,
  onReschedule,
  onCancel,
}: {
  booking: WebsiteBooking
  onView: () => void
  onAddToCalendar: () => void
  onReschedule: () => void
  onCancel: () => void
}) {
  const canAddToCalendar = !booking.appointmentId && booking.status !== 'cancelled'
  const canCancel = booking.status !== 'cancelled'
  const canReschedule = booking.status !== 'cancelled'

  return (
    <div className="px-2 py-2 border-b last:border-b-0 border-border/40">
      <button
        type="button"
        onClick={onView}
        className="w-full text-left flex items-start gap-2 rounded-lg hover:bg-muted/50 transition-colors px-1.5 py-1.5"
      >
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold truncate">{booking.name}</p>
            <Badge
              variant={STATUS_VARIANTS[booking.status] ?? 'outline'}
              className="capitalize text-[10px] h-4 px-1.5 shrink-0"
            >
              {booking.status}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            <SourceTag source={booking.source} />
            {booking.requestType && booking.requestType !== 'new' && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium capitalize text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                {booking.requestType}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{booking.phone}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {booking.service ? (
              <span className="capitalize">{booking.service}</span>
            ) : (
              'Service TBD'
            )}
            {booking.preferredDate && (
              <>
                {' · '}
                {booking.preferredDate}
                {booking.preferredTime ? ` at ${booking.preferredTime}` : ''}
              </>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            Received {format(new Date(booking.createdAt), 'MMM d')}
          </p>
        </div>
      </button>
      <div
        className="mt-1.5 flex items-center justify-between gap-2 px-1.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Button
          size="sm"
          variant="outline"
          className="h-7 flex-1 gap-1.5"
          disabled={!canAddToCalendar}
          onClick={onAddToCalendar}
        >
          <CalendarPlus className="h-3 w-3" />
          {booking.appointmentId ? 'View appointment' : 'Add to calendar'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-7 w-7" aria-label="More options">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem disabled={!canReschedule} onSelect={onReschedule}>
              <CalendarPlus className="mr-2 h-4 w-4" />
              {booking.appointmentId ? 'Reschedule appointment' : 'Reschedule'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!canCancel}
              onSelect={onCancel}
              className="text-destructive focus:text-destructive"
            >
              <X className="mr-2 h-4 w-4" />
              Cancel booking
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
