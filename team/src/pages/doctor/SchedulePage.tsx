import { addDays, format } from 'date-fns'
import { Ban, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'

interface Appointment {
  id: string
  date: string
  durationMinutes: number
  status: AppointmentStatus
  type: string
  notes: string | null
  patient?: { name: string }
  doctor?: { user?: { id: string } }
}

type Day = -1 | 0 | 1

const STATUS_PILL: Record<AppointmentStatus, string> = {
  scheduled: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-indigo-100 text-indigo-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-red-100 text-red-700',
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
}

interface BlockSlot {
  kind: 'block'
  id: string
  startsAt: string
  endsAt: string
  reason: string
}
interface AppointmentSlot {
  kind: 'appointment'
  id: string
  data: Appointment
}
type Slot = BlockSlot | AppointmentSlot

function apptStartsAt(a: Appointment): number {
  return new Date(a.date).getTime()
}
function apptEndsAt(a: Appointment): number {
  return new Date(a.date).getTime() + a.durationMinutes * 60000
}

export default function DoctorSchedulePage() {
  const { user } = useAuth()
  const [day, setDay] = useState<Day>(0)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<Appointment[]>('/api/appointments')
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setAppointments(res.data)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const target = addDays(new Date(), day)
  target.setHours(0, 0, 0, 0)
  const dayStart = target.getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000

  const slots = useMemo<Slot[]>(() => {
    const appts: Slot[] = appointments
      .filter((a) => {
        const t = apptStartsAt(a)
        const belongsToDoctor = !user?.id || a.doctor?.user?.id === user.id
        return t >= dayStart && t < dayEnd && belongsToDoctor
      })
      .map((a) => ({ kind: 'appointment' as const, id: a.id, data: a }))

    const blocks: Slot[] =
      day === 0
        ? [
            {
              kind: 'block',
              id: 'block-lunch',
              startsAt: new Date(dayStart + 12 * 60 * 60 * 1000).toISOString(),
              endsAt: new Date(dayStart + 13 * 60 * 60 * 1000).toISOString(),
              reason: 'Lunch break',
            },
          ]
        : []

    return [...appts, ...blocks].sort((a, b) => {
      const aStart = a.kind === 'appointment' ? a.data.date : a.startsAt
      const bStart = b.kind === 'appointment' ? b.data.date : b.startsAt
      return aStart.localeCompare(bStart)
    })
  }, [appointments, day, dayStart, dayEnd, user?.id])

  const now = Date.now()

  return (
    <div className="p-5 pb-8 space-y-4">
      <div className="pt-2">
        <h1 className="text-2xl font-bold tracking-tight">Today's schedule</h1>
        <p className="text-sm text-muted-foreground">{format(target, 'EEEE, MMM d')}</p>
      </div>

      <div className="flex gap-2">
        {[
          { v: -1 as Day, l: 'Yesterday' },
          { v: 0 as Day, l: 'Today' },
          { v: 1 as Day, l: 'Tomorrow' },
        ].map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => setDay(opt.v)}
            className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              day === opt.v
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border'
            }`}
          >
            {opt.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : slots.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-12">
          No appointments {day === 0 ? 'today' : day === -1 ? 'yesterday' : 'tomorrow'}.
        </p>
      ) : (
        <div className="space-y-2">
          {slots.map((s) =>
            s.kind === 'block' ? (
              <Card key={s.id} className="bg-muted/50 border-dashed">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="text-xs font-mono text-muted-foreground w-20 shrink-0">
                    {format(new Date(s.startsAt), 'HH:mm')}
                  </div>
                  <Ban className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Block: {s.reason}</span>
                </CardContent>
              </Card>
            ) : (
              <ScheduleRow
                key={s.id}
                appt={s.data}
                now={now}
                STATUS_PILL={STATUS_PILL}
                STATUS_LABEL={STATUS_LABEL}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

function ScheduleRow({
  appt,
  now,
  STATUS_PILL,
  STATUS_LABEL,
}: {
  appt: Appointment
  now: number
  STATUS_PILL: Record<AppointmentStatus, string>
  STATUS_LABEL: Record<AppointmentStatus, string>
}) {
  const past = apptEndsAt(appt) < now
  const navigate = useNavigate()
  return (
    <Card
      className={`cursor-pointer hover:bg-accent/50 transition-colors ${past ? 'opacity-60' : ''}`}
      onClick={() => navigate(`/doctor/appointments/${appt.id}`)}
    >
      <CardContent className="p-3 flex items-start gap-3">
        <div className="text-xs font-mono text-muted-foreground w-20 shrink-0 leading-snug">
          <div>{format(new Date(appt.date), 'HH:mm')}</div>
          <div className="opacity-60">{format(new Date(apptEndsAt(appt)), 'HH:mm')}</div>
          <div className="opacity-60">{appt.durationMinutes}m</div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{appt.patient?.name ?? '—'}</p>
          <p className="text-xs text-muted-foreground truncate">{appt.type}</p>
          {appt.notes && (
            <p className="text-xs text-muted-foreground/80 truncate mt-0.5">{appt.notes}</p>
          )}
        </div>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_PILL[appt.status]}`}
        >
          {STATUS_LABEL[appt.status]}
        </span>
      </CardContent>
    </Card>
  )
}
