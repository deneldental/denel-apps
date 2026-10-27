import { useQueryClient } from '@tanstack/react-query'
import { addDays, endOfWeek, format, isSameDay, isToday, startOfDay, startOfWeek } from 'date-fns'
import {
  Bell,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Plus,
  Slash,
  UserCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { actionsFor, canCheckIn } from '@/features/appointments/appointment-actions'
import { AddAppointmentSheet } from '@/features/appointments/components/add-appointment-sheet'
import { AddWalkInSheet } from '@/features/appointments/components/add-walk-in-sheet'
import {
  RescheduleAppointmentDialog,
  SendReminderDialog,
} from '@/features/appointments/components/appointment-action-dialogs'
import { BlockTimeSheet } from '@/features/appointments/components/block-time-sheet'
import { CheckInFlow } from '@/features/appointments/components/check-in-flow'
import {
  type WebsiteBooking,
  WebsiteBookingsPanel,
} from '@/features/appointments/components/website-bookings-panel'
import { api } from '@/lib/api-client'
import { useCan } from '@/lib/permissions-context'
import { useApiQuery } from '@/lib/query'
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar'
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
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Label } from '@/shared/components/ui/label'
import { ScrollArea } from '@/shared/components/ui/scroll-area'
import { Textarea } from '@/shared/components/ui/textarea'

// ── Types ────────────────────────────────────────────────────────────────────

type AppointmentLike = {
  id: string
  date: Date | string
  status?: string
  durationMinutes?: number
  type?: string
  /** Declared explicitly (not left to the index signature) because the
   *  reschedule dialog uses it to pre-check the doctor's block times. */
  doctorId?: string
  patient?: {
    id?: string
    name?: string
    phone?: string | null
    address?: string | null
    profileImage?: string | null
  }
  patientId?: string
  doctor?: {
    id?: string
    user?: { name?: string }
  }
  [key: string]: unknown
}

type UnavailabilityLike = {
  id: string
  startTime: Date | string
  endTime: Date | string
  reason?: string | null
  doctor?: { user?: { name?: string } }
  [key: string]: unknown
}

interface Props {
  appointments: AppointmentLike[]
  unavailability: UnavailabilityLike[]
  selectedDate?: Date
  onSelectedDateChange?: (date: Date) => void
  onAppointmentClick?: (a: AppointmentLike) => void
  onUnavailabilityClick?: (u: UnavailabilityLike) => void
  onReload?: () => void
  /** Doctor context passed through to BlockTimeSheet so doctors can quickly
   *  block their own time without picking themselves from a dropdown. */
  currentDoctorId?: string
  currentDoctorName?: string
  isClinicalUser?: boolean
  className?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string | undefined | null): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

const STATUS_TONE: Record<string, string> = {
  scheduled: 'text-blue-600 dark:text-blue-400',
  confirmed: 'text-emerald-600 dark:text-emerald-400',
  checked_in: 'text-emerald-700 dark:text-emerald-300',
  in_chair: 'text-emerald-700 dark:text-emerald-300',
  completed: 'text-slate-500 dark:text-slate-400',
  no_show: 'text-amber-600 dark:text-amber-400',
  cancelled: 'text-red-600 dark:text-red-400',
  rescheduled: 'text-amber-600 dark:text-amber-400',
}

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show', 'no-show'])

// No shared query-key group exists for website bookings yet — a local,
// module-scoped literal shared by the read below and the cache write in
// `onChange` (WebsiteBookingsPanel refetches internally then hands the
// fresh list back up via `onChange`, so this key mirrors that list).
const websiteBookingsKey = ['website-bookings'] as const

// ── Main column ──────────────────────────────────────────────────────────────

type TabValue = 'today' | 'website' | 'blocked'

export function UpcomingAppointmentsColumn({
  appointments,
  unavailability,
  selectedDate: controlledDate,
  onSelectedDateChange,
  onAppointmentClick,
  onUnavailabilityClick,
  onReload,
  currentDoctorId,
  currentDoctorName,
  isClinicalUser,
  className,
}: Props) {
  const canBlockTime = useCan('appointments', 'create')
  const [internalDate, setInternalDate] = useState<Date>(startOfDay(new Date()))
  const selectedDate = controlledDate ?? internalDate
  const setSelectedDate = (d: Date) => {
    if (onSelectedDateChange) onSelectedDateChange(d)
    else setInternalDate(d)
  }

  const [activeTab, setActiveTab] = useState<TabValue>('today')

  // Single source of truth for website bookings — fetched here so the Today
  // tab can show a live count badge, and passed down to the Website tab so it
  // doesn't double-fetch. Status mapping mirrors WebsiteBookingsPanel.
  // Doctors never see the Requests tab, so the query is disabled entirely.
  const queryClient = useQueryClient()
  const bookingsQuery = useApiQuery(
    websiteBookingsKey,
    () => api.get<WebsiteBooking[]>('/api/website-bookings'),
    { enabled: !isClinicalUser }
  )
  const websiteBookings = bookingsQuery.data ?? []
  const setWebsiteBookings = (next: WebsiteBooking[]) =>
    queryClient.setQueryData(websiteBookingsKey, next)

  const websitePending = useMemo(
    () => websiteBookings.filter((b) => b.status === 'new' || b.status === 'contacted').length,
    [websiteBookings]
  )
  const blockedUpcoming = useMemo(() => {
    const now = Date.now()
    return unavailability.filter((u) => new Date(u.endTime).getTime() >= now).length
  }, [unavailability])

  return (
    <div className={`flex flex-col rounded-2xl border bg-card ${className ?? ''}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-2 shrink-0">
        <h3 className="text-base font-semibold truncate">Today's Appointments</h3>
        <div className="flex items-center gap-1">
          {!isClinicalUser && activeTab === 'today' && (
            <>
              <AddWalkInSheet
                trigger={
                  <Button size="sm" variant="outline" className="h-8 gap-1.5">
                    <UserCheck className="h-3.5 w-3.5" />
                    Walk-in
                  </Button>
                }
                onCreated={onReload}
              />
              <AddAppointmentSheet
                defaultDate={selectedDate}
                trigger={
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New
                  </Button>
                }
                onCreated={onReload}
              />
            </>
          )}
          {/* Doctors may block their own time — the sheet locks the doctor field
              to them when currentDoctorId is known. H5 — this had no permission
              check at all; the backend requires appointments:create
              (`POST /api/doctors/unavailability`). */}
          {activeTab === 'blocked' && canBlockTime && (
            <BlockTimeSheet
              currentDoctorId={currentDoctorId}
              currentDoctorName={currentDoctorName}
              isDoctor={!!currentDoctorId}
              onCreated={onReload}
            />
          )}
        </div>
      </div>

      {/* Tabs. Doctors get Today + Blocked only — website booking requests are
          reception's queue. */}
      <div className="px-4 pb-3 shrink-0">
        <div className="inline-flex w-full rounded-md border bg-muted/30 p-0.5 text-xs">
          <TabButton
            active={activeTab === 'today'}
            onClick={() => setActiveTab('today')}
            label="Today"
          />
          {!isClinicalUser && (
            <TabButton
              active={activeTab === 'website'}
              onClick={() => setActiveTab('website')}
              label="Requests"
              count={websitePending}
            />
          )}
          <TabButton
            active={activeTab === 'blocked'}
            onClick={() => setActiveTab('blocked')}
            label={isClinicalUser ? 'Unavailable' : 'Blocked'}
            count={blockedUpcoming}
          />
        </div>
      </div>

      {/* Body */}
      {activeTab === 'today' && (
        <TodayTab
          appointments={appointments}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          onAppointmentClick={onAppointmentClick}
          isClinicalUser={isClinicalUser}
          onReload={() => {
            onReload?.()
            bookingsQuery.refetch()
          }}
        />
      )}
      {activeTab === 'website' && (
        <WebsiteBookingsPanel
          bookings={websiteBookings}
          onChange={setWebsiteBookings}
          onAppointmentChange={onReload}
        />
      )}
      {activeTab === 'blocked' && (
        <BlockedList
          unavailability={unavailability}
          onUnavailabilityClick={onUnavailabilityClick}
          isClinicalUser={isClinicalUser}
        />
      )}
    </div>
  )
}

// ── Sub: tab button ──────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex-1 inline-flex items-center justify-center gap-1.5 rounded px-2 py-1.5 transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      <span>{label}</span>
      {count != null && count > 0 && (
        <Badge
          variant={active ? 'default' : 'secondary'}
          className="h-4 px-1.5 text-[10px] tabular-nums"
        >
          {count}
        </Badge>
      )}
    </button>
  )
}

// ── Today tab ────────────────────────────────────────────────────────────────

function TodayTab({
  appointments,
  selectedDate,
  setSelectedDate,
  onAppointmentClick,
  isClinicalUser,
  onReload,
}: {
  appointments: AppointmentLike[]
  selectedDate: Date
  setSelectedDate: (d: Date) => void
  onAppointmentClick?: (a: AppointmentLike) => void
  isClinicalUser?: boolean
  onReload: () => void
}) {
  const weekStart = useMemo(() => startOfWeek(selectedDate, { weekStartsOn: 1 }), [selectedDate])
  const weekEnd = useMemo(() => endOfWeek(selectedDate, { weekStartsOn: 1 }), [selectedDate])
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )
  const today = useMemo(() => startOfDay(new Date()), [])

  // Sidebar shows ACTIONABLE items only:
  //   • drops terminal-status rows (cancelled / no_show / completed) — those
  //     are history, viewable on the calendar grid for context but never
  //     actionable here.
  //   • drops past-time items on today's view once the patient has arrived —
  //     they are in the clinic flow, and stale items push real upcoming work
  //     below the fold. A visit whose time has passed but who has NOT arrived
  //     stays: that is a late patient, and the receptionist still has to check
  //     them in (or mark them a no-show). Dropping them hid exactly the people
  //     who needed attention.
  // Past/historical inspection still happens on the calendar by clicking the
  // appointment dot → detail dialog.
  const dayAppointments = useMemo(() => {
    const now = Date.now()
    const isTodaySelected = isSameDay(selectedDate, today)
    return appointments
      .filter((a) => isSameDay(new Date(a.date), selectedDate))
      .filter((a) => {
        const status = (a.status ?? 'scheduled') as string
        return !TERMINAL_STATUSES.has(status)
      })
      .filter((a) => {
        if (!isTodaySelected) return true
        return new Date(a.date).getTime() >= now || canCheckIn(a.status)
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [appointments, selectedDate, today])

  const [checkInAppt, setCheckInAppt] = useState<AppointmentLike | null>(null)
  const [noShowAppt, setNoShowAppt] = useState<AppointmentLike | null>(null)
  const [cancelAppt, setCancelAppt] = useState<AppointmentLike | null>(null)
  const [rescheduleAppt, setRescheduleAppt] = useState<AppointmentLike | null>(null)
  const [reminderAppt, setReminderAppt] = useState<AppointmentLike | null>(null)
  const [noShowNote, setNoShowNote] = useState('')
  const [cancelNote, setCancelNote] = useState('')
  const [processing, setProcessing] = useState<string | null>(null)

  async function confirmNoShow() {
    if (!noShowAppt) return
    setProcessing(noShowAppt.id)
    try {
      const payload: { action: string; notes?: string } = { action: 'no-show' }
      if (noShowNote.trim()) payload.notes = noShowNote.trim()
      const res = await api.patch(`/api/appointment-workflow/${noShowAppt.id}/transition`, payload)
      if (res.success) {
        toast.success('Marked as no-show')
        setNoShowAppt(null)
        setNoShowNote('')
        onReload()
      } else {
        toast.error((res.error as string) || 'Failed to mark no-show')
      }
    } finally {
      setProcessing(null)
    }
  }

  async function confirmCancel() {
    if (!cancelAppt) return
    setProcessing(cancelAppt.id)
    try {
      const payload: { action: string; notes?: string } = { action: 'cancel' }
      if (cancelNote.trim()) payload.notes = cancelNote.trim()
      const res = await api.patch(`/api/appointment-workflow/${cancelAppt.id}/transition`, payload)
      if (res.success) {
        toast.success('Appointment cancelled')
        setCancelAppt(null)
        setCancelNote('')
        onReload()
      } else {
        toast.error((res.error as string) || 'Failed to cancel')
      }
    } finally {
      setProcessing(null)
    }
  }

  // Send-reminder is no longer fire-and-forget — the dropdown now opens
  // <SendReminderDialog> with a template preview so the receptionist can
  // confirm the message and phone before the SMS actually goes out.

  // Week strip can't navigate to a week entirely in the past. Going back is
  // blocked once we'd land in a week before this one. Individual past days
  // inside the current week are rendered but disabled.
  const canGoPreviousWeek =
    startOfDay(addDays(selectedDate, -7)) >= startOfWeek(today, { weekStartsOn: 1 })

  return (
    <>
      {/* Week strip */}
      <div className="px-4 pb-3 flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={!canGoPreviousWeek}
          onClick={() => setSelectedDate(addDays(selectedDate, -7))}
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex flex-1 items-center justify-between">
          {days.map((d) => {
            const isSelected = isSameDay(d, selectedDate)
            const isCurrent = isToday(d)
            const isPast = startOfDay(d) < today
            return (
              <button
                key={d.toISOString()}
                type="button"
                disabled={isPast}
                onClick={() => !isPast && setSelectedDate(d)}
                className={[
                  'flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-md text-xs transition-colors',
                  isPast
                    ? 'text-muted-foreground/30 cursor-not-allowed'
                    : isSelected
                      ? 'bg-orange-500 text-white shadow-sm'
                      : isCurrent
                        ? 'text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <span className="text-[10px] uppercase tracking-wide">{format(d, 'EEE')}</span>
                <span className="text-sm font-semibold tabular-nums">{format(d, 'd')}</span>
              </button>
            )
          })}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setSelectedDate(addDays(selectedDate, 7))}
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Date label */}
      <div className="px-4 pb-2 text-xs text-muted-foreground shrink-0">
        {format(selectedDate, 'EEEE, MMMM d, yyyy')} ·{' '}
        <span className="text-foreground">
          {dayAppointments.length} appointment{dayAppointments.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Appointment cards */}
      <ScrollArea className="flex-1 min-h-0">
        {dayAppointments.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No appointments on {format(selectedDate, 'MMM d')}.
            {isSameDay(selectedDate, weekEnd) && (
              <p className="mt-1 text-xs">Week ends here — use ▶ to advance.</p>
            )}
          </div>
        ) : (
          <div className="px-2 pb-3">
            {dayAppointments.map((a) => (
              <AppointmentCard
                key={a.id}
                appointment={a}
                isBusy={processing === a.id}
                isClinicalUser={isClinicalUser}
                onView={() => onAppointmentClick?.(a)}
                onCheckIn={() => setCheckInAppt(a)}
                onCancel={() => setCancelAppt(a)}
                onNoShow={() => setNoShowAppt(a)}
                onSendReminder={() => setReminderAppt(a)}
                onReschedule={() => setRescheduleAppt(a)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Check in — payment (one-time / plan / insurance) or no payment, then the
          check-in itself. The flow is told THIS visit, so a payment names it, and
          it reports a failed check-in instead of closing as if it had worked. */}
      <CheckInFlow
        appointment={checkInAppt}
        onFinished={() => {
          setCheckInAppt(null)
          onReload()
        }}
      />

      {/* Reschedule — date/time only, prefilled. */}
      <RescheduleAppointmentDialog
        open={!!rescheduleAppt}
        onOpenChange={(v) => {
          if (!v) setRescheduleAppt(null)
        }}
        appointment={rescheduleAppt}
        onRescheduled={() => {
          setRescheduleAppt(null)
          onReload()
        }}
      />

      {/* Send Reminder — SMS template preview + confirm. */}
      <SendReminderDialog
        open={!!reminderAppt}
        onOpenChange={(v) => {
          if (!v) setReminderAppt(null)
        }}
        appointment={reminderAppt}
        onSent={() => setReminderAppt(null)}
      />

      {/* No-show confirmation */}
      <Dialog
        open={!!noShowAppt}
        onOpenChange={(v) => {
          if (!v) {
            setNoShowAppt(null)
            setNoShowNote('')
          }
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Mark as No-Show</DialogTitle>
            <DialogDescription>
              Confirm that {noShowAppt?.patient?.name ?? 'this patient'} did not attend their
              appointment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="no-show-note">Note (optional)</Label>
            <Textarea
              id="no-show-note"
              placeholder="Add a note about this no-show…"
              value={noShowNote}
              onChange={(e) => setNoShowNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNoShowAppt(null)
                setNoShowNote('')
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmNoShow} disabled={!!processing}>
              {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm No-Show
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation */}
      <Dialog
        open={!!cancelAppt}
        onOpenChange={(v) => {
          if (!v) {
            setCancelAppt(null)
            setCancelNote('')
          }
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Cancel appointment</DialogTitle>
            <DialogDescription>
              Cancel {cancelAppt?.patient?.name ?? "this patient's"} appointment? The slot will be
              freed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-note">Reason (optional)</Label>
            <Textarea
              id="cancel-note"
              placeholder="e.g. patient called to reschedule…"
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCancelAppt(null)
                setCancelNote('')
              }}
            >
              Keep
            </Button>
            <Button variant="destructive" onClick={confirmCancel} disabled={!!processing}>
              {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancel Appointment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Sub: appointment card with check-in + ellipsis menu ─────────────────────

function AppointmentCard({
  appointment,
  isBusy,
  isClinicalUser,
  onView,
  onCheckIn,
  onCancel,
  onNoShow,
  onSendReminder,
  onReschedule,
}: {
  appointment: AppointmentLike
  isBusy: boolean
  // H5 — the Appointment Detail Dialog already hides these same actions
  // (readOnly={isClinicalUser}) for a clinical-only role; this card exposed
  // Check-in/Reschedule/Send reminder/Mark no-show/Cancel with zero gating.
  isClinicalUser?: boolean
  onView: () => void
  onCheckIn: () => void
  onCancel: () => void
  onNoShow: () => void
  onSendReminder: () => void
  onReschedule: () => void
}) {
  const dt = new Date(appointment.date)
  const time = format(dt, 'h:mm a')
  const patientName = appointment.patient?.name ?? 'Unknown patient'
  const doctorName = appointment.doctor?.user?.name ?? 'Unassigned'
  const status = (appointment.status ?? 'scheduled') as string
  const actions = actionsFor(status)
  const hasMenu = actions.reschedule || actions.sendReminder || actions.noShow || actions.cancel
  const tone = STATUS_TONE[status] ?? 'text-muted-foreground'

  return (
    <div className="px-2 py-2 border-b last:border-b-0 border-border/40">
      <button
        type="button"
        onClick={onView}
        className="w-full text-left flex items-start gap-3 rounded-lg hover:bg-muted/50 transition-colors px-1 py-1"
      >
        <Avatar className="h-9 w-9 shrink-0">
          {appointment.patient?.profileImage ? (
            <AvatarImage src={appointment.patient.profileImage} alt={patientName} />
          ) : (
            <AvatarFallback className="text-xs">{getInitials(patientName)}</AvatarFallback>
          )}
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{patientName}</p>
          {appointment.patient?.phone && (
            <p className="text-[11px] text-muted-foreground truncate">
              {appointment.patient.phone}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground truncate">{doctorName}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-medium">{time}</div>
          <div className={`text-[10px] capitalize ${tone}`}>{status.replace('_', ' ')}</div>
        </div>
      </button>

      {!isClinicalUser && (actions.checkIn || hasMenu) && (
        <div
          className={`mt-1.5 flex items-center gap-2 px-1 ${actions.checkIn ? 'justify-between' : 'justify-end'}`}
        >
          {actions.checkIn && (
            <Button
              size="sm"
              className="h-7 flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={isBusy}
              onClick={onCheckIn}
            >
              {isBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <UserCheck className="h-3 w-3" />
              )}
              Check In
            </Button>
          )}
          {hasMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={isBusy}
                  aria-label="More options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actions.reschedule && (
                  <DropdownMenuItem onSelect={onReschedule}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    Reschedule
                  </DropdownMenuItem>
                )}
                {actions.sendReminder && (
                  <DropdownMenuItem onSelect={onSendReminder}>
                    <Bell className="mr-2 h-4 w-4" />
                    Send reminder
                  </DropdownMenuItem>
                )}
                {actions.noShow && (
                  <DropdownMenuItem
                    onSelect={onNoShow}
                    className="text-amber-600 focus:text-amber-600"
                  >
                    <Slash className="mr-2 h-4 w-4" />
                    Mark no-show
                  </DropdownMenuItem>
                )}
                {actions.cancel && (
                  <DropdownMenuItem
                    onSelect={onCancel}
                    className="text-destructive focus:text-destructive"
                  >
                    Cancel appointment
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  )
}

// ── Blocked time list ───────────────────────────────────────────────────────

function BlockedList({
  unavailability,
  onUnavailabilityClick,
  isClinicalUser,
}: {
  unavailability: UnavailabilityLike[]
  onUnavailabilityClick?: (u: UnavailabilityLike) => void
  isClinicalUser?: boolean
}) {
  const upcoming = useMemo(() => {
    const now = Date.now()
    return unavailability
      .filter((u) => new Date(u.endTime).getTime() >= now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }, [unavailability])

  if (upcoming.length === 0) {
    return (
      <div className="px-5 py-10 text-center text-sm text-muted-foreground">
        <Slash className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
        No upcoming blocked periods.
        <p className="mt-1 text-xs">
          Use <strong>Block Time</strong> above to mark{' '}
          {isClinicalUser ? 'yourself unavailable' : "a doctor's time unavailable"}.
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="px-2 pb-3">
        {upcoming.map((u) => {
          const start = new Date(u.startTime)
          const end = new Date(u.endTime)
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => onUnavailabilityClick?.(u)}
              className="w-full text-left px-3 py-2.5 border-b last:border-b-0 border-border/40 hover:bg-muted/50 rounded-md transition-colors"
            >
              <p className="text-sm font-semibold truncate">{u.doctor?.user?.name ?? 'Doctor'}</p>
              <p className="text-[11px] text-muted-foreground">
                {format(start, 'MMM d')} · {format(start, 'h:mm a')} – {format(end, 'h:mm a')}
              </p>
              {u.reason && (
                <p className="text-[11px] text-muted-foreground italic truncate">{u.reason}</p>
              )}
            </button>
          )
        })}
      </div>
    </ScrollArea>
  )
}
