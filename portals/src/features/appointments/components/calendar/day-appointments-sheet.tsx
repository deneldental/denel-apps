import { format } from 'date-fns'
import { CalendarX2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { getAppointmentColour } from '@/shared/utils/appointment-colours'
import {
  type AppointmentStatus,
  getAppointmentDimming,
  getAppointmentStatusStyle,
  isAppointmentPast,
} from '@/shared/utils/appointment-status'

interface Appointment {
  id: string
  date: Date | string
  status?: string
  type?: string
  [key: string]: unknown
}

interface CalendarEvent {
  id: string
  title: string
  date: Date
  type: 'appointment' | 'unavailability'
  appointment?: Appointment
}

interface DayAppointmentsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  date: Date | null
  events: CalendarEvent[]
  onEventClick?: (event: CalendarEvent) => void
  /**
   * Optional — when omitted the sheet falls back to the status-style
   * palette. Supplied by the calendar views so the overflow rows match the
   * cells behind them.
   */
  appointmentTypesLookup?: Map<string, { colour?: string }>
}

export function DayAppointmentsSheet({
  open,
  onOpenChange,
  date,
  events,
  onEventClick,
  appointmentTypesLookup,
}: DayAppointmentsSheetProps) {
  const lookup = appointmentTypesLookup ?? new Map<string, { colour?: string }>()
  const count = events.length
  const titleDate = date ? format(date, 'EEE, MMM d, yyyy') : ''

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="!w-full !max-w-[420px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Appointments — {titleDate}</SheetTitle>
          <SheetDescription>
            {count === 0
              ? 'No appointments scheduled.'
              : `${count} appointment${count === 1 ? '' : 's'}`}
          </SheetDescription>
        </SheetHeader>

        {count === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
            <CalendarX2 className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">No appointments</p>
            <p className="text-xs text-muted-foreground/70">Nothing scheduled for this day.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {events.map((event) => {
              if (event.type !== 'appointment') {
                const blockedColour = getAppointmentColour(null, 'blocked', lookup)
                return (
                  <button
                    key={`${event.type}-${event.id}`}
                    type="button"
                    onClick={() => onEventClick?.(event)}
                    className="flex w-full items-stretch overflow-hidden rounded-md border text-left text-sm transition-colors hover:brightness-95"
                    style={{
                      backgroundColor: blockedColour.background,
                      color: blockedColour.text,
                      borderColor: blockedColour.border,
                    }}
                  >
                    <div
                      className="w-1 flex-shrink-0"
                      style={{ backgroundColor: blockedColour.border ?? blockedColour.text }}
                    />
                    <div className="flex-1 px-3 py-2">
                      <p className="font-semibold">{format(event.date, 'HH:mm')}</p>
                      <p className="text-xs">{blockedColour.label ?? event.title}</p>
                    </div>
                  </button>
                )
              }

              const apt = event.appointment
              const status = (apt?.status ?? 'scheduled') as AppointmentStatus
              // Legacy status-style drives the badge pill + its outline —
              // the calendar colour helper owns the card background/border.
              const style = getAppointmentStatusStyle(status)
              const past = isAppointmentPast(event.date)
              const dim = getAppointmentDimming(status, past)
              const dashed = status === 'no_show'
              const colour = getAppointmentColour(apt?.type, status, lookup)
              const strike = colour.strikethrough || dim.strikethrough

              const patientName =
                apt && typeof apt.patient === 'object' && apt.patient
                  ? ((apt.patient as { name?: string }).name ?? event.title)
                  : event.title

              const doctorName =
                apt && typeof apt.doctor === 'object' && apt.doctor
                  ? ((apt.doctor as { user?: { name?: string } }).user?.name ?? null)
                  : null

              const notes =
                apt && typeof apt.notes === 'string' && apt.notes.length > 0
                  ? (apt.notes as string)
                  : null

              const durationMinutes =
                apt && typeof apt.durationMinutes === 'number'
                  ? (apt.durationMinutes as number)
                  : null
              const endDate = durationMinutes
                ? new Date(event.date.getTime() + durationMinutes * 60000)
                : null

              return (
                <button
                  key={`${event.type}-${event.id}`}
                  type="button"
                  onClick={() => onEventClick?.(event)}
                  className={cn(
                    'flex w-full items-stretch overflow-hidden rounded-md text-left transition-colors hover:brightness-95',
                    dim.opacity
                  )}
                  style={{ backgroundColor: colour.background, color: colour.text }}
                >
                  <div
                    className={cn(
                      'w-1 flex-shrink-0',
                      dashed && 'border-l-2 border-dashed border-current bg-transparent'
                    )}
                    style={dashed ? undefined : { backgroundColor: colour.border ?? colour.text }}
                  />
                  <div className="flex-1 min-w-0 px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {format(event.date, 'HH:mm')}
                        {endDate ? ` – ${format(endDate, 'HH:mm')}` : ''}
                      </p>
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                          style.border
                        )}
                      >
                        {style.badgeLabel}
                      </span>
                    </div>
                    <p
                      className={cn(
                        'mt-0.5 text-sm font-medium truncate',
                        strike && 'line-through'
                      )}
                    >
                      {patientName}
                    </p>
                    {doctorName && <p className="text-xs opacity-80 truncate">{doctorName}</p>}
                    {notes && <p className="mt-1 text-xs opacity-70 line-clamp-2">{notes}</p>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
