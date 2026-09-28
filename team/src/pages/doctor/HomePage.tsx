import { NavCard, StatCard, WelcomeCard } from '@denel/ui/blocks'
import { format } from 'date-fns'
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  FileText,
  LogIn,
  Search,
  Sparkles,
  Stethoscope,
  User,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  doctor?: { user?: { id: string; name: string } }
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

function endsAt(appt: Appointment): number {
  return new Date(appt.date).getTime() + appt.durationMinutes * 60000
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const t = new Date()
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  )
}

export default function DoctorHomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const todayName = format(new Date(), 'EEEE, MMM d')
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<Appointment[]>('/api/appointments')
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setAppointments(res.data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const todays = useMemo(() => {
    return appointments
      .filter((a) => isToday(a.date) && a.doctor?.user?.id === user?.id)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [appointments, user?.id])

  const now = Date.now()
  const current = todays.find((a) => {
    const start = new Date(a.date).getTime()
    const end = endsAt(a)
    return start <= now && now < end && a.status !== 'cancelled'
  })
  const upNext = todays.find((a) => new Date(a.date).getTime() > now && a.status !== 'cancelled')

  const stats = useMemo(
    () => ({
      bookedCount: todays.filter((a) => ['scheduled', 'confirmed'].includes(a.status)).length,
      checkedInCount: todays.filter((a) => a.status === 'checked_in').length,
      inProgressCount: todays.filter((a) => a.status === 'in_progress').length,
      completedCount: todays.filter((a) => a.status === 'completed').length,
    }),
    [todays]
  )

  const firstName = user?.name?.split(' ').slice(-1)[0] ?? ''

  if (loading) {
    return (
      <div className="page-enter space-y-3 p-5">
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-28 rounded-2xl" />
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-20 rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="page-enter space-y-3 p-5">
      <WelcomeCard
        name={firstName ? `Dr ${firstName}` : 'Doctor'}
        subtitle={`Doctor · ${todayName}`}
      />

      {/* Now — the live appointment, surfaced first with an accented card. */}
      {current ? (
        <div className="rounded-2xl border border-brand/25 bg-brand/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" />
            <span className="text-xs font-semibold uppercase tracking-wider text-brand">Now</span>
          </div>
          <p className="font-mono text-sm text-muted-foreground">
            {format(new Date(current.date), 'HH:mm')} – {format(new Date(endsAt(current)), 'HH:mm')}
          </p>
          <h2 className="text-lg font-bold leading-tight">{current.patient?.name ?? '—'}</h2>
          {current.notes && <p className="mt-1 text-sm text-muted-foreground">{current.notes}</p>}
          <Badge variant="secondary" className="mt-2">
            {STATUS_LABEL[current.status]}
          </Badge>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate(`/doctor/appointments/${current.id}`)}>
              Open chart
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toast.info('Quick note — use the notes page')}
            >
              Add note
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Nothing on now. Enjoy a quick break.</p>
        </div>
      )}

      {/* Up next */}
      {upNext && (
        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-sky-700/80">
            Up next
          </p>
          <p className="font-mono text-sm text-sky-700/80">
            {format(new Date(upNext.date), 'HH:mm')} – {format(new Date(endsAt(upNext)), 'HH:mm')}
          </p>
          <p className="text-sm font-semibold text-sky-900">{upNext.patient?.name ?? '—'}</p>
          {upNext.notes && <p className="text-xs text-sky-700/70">{upNext.notes}</p>}
        </div>
      )}

      {/* Today at a glance */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard tone="brand" icon={CalendarDays} value={stats.bookedCount} label="Booked" />
        <StatCard tone="sky" icon={LogIn} value={stats.checkedInCount} label="Checked in" />
        <StatCard
          tone="amber"
          icon={Stethoscope}
          value={stats.inProgressCount}
          label="In progress"
        />
        <StatCard tone="emerald" icon={CheckCircle2} value={stats.completedCount} label="Done" />
      </div>

      {/* Actions */}
      <NavCard
        tone="indigo"
        icon={CalendarClock}
        title="Today's schedule"
        subtitle="Full day — yesterday, today, tomorrow"
        to="/doctor/today"
      />
      <div className="grid grid-cols-2 gap-3">
        <NavCard
          tone="violet"
          icon={Search}
          title="Find patient"
          to="/doctor/patients"
          chevron={false}
        />
        <NavCard
          tone="teal"
          icon={FileText}
          title="Quick note"
          to="/doctor/notes"
          chevron={false}
        />
      </div>
      <NavCard
        tone="rose"
        icon={User}
        title="My profile"
        subtitle="Preferences & sign out"
        to="/doctor/profile"
      />
    </div>
  )
}
