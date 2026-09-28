import { NavCard, StatCard, WelcomeCard } from '@denel/ui/blocks'
import { isBefore } from 'date-fns'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  Repeat2,
  Target,
  Timer,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { labApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface LabCaseLite {
  status: string
  expectedReturn: string | null
  insertedAt: string | null
  sentAt: string | null
  delayReason?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const ACTIVE_STATUSES = ['sent', 'in_progress', 'received', 'ready_for_insertion']

function isDueToday(c: LabCaseLite): boolean {
  if (!c.expectedReturn || c.status === 'inserted' || c.status === 'cancelled') return false
  const d = new Date(c.expectedReturn)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function isOverdue(c: LabCaseLite): boolean {
  return (
    !!c.expectedReturn &&
    isBefore(new Date(c.expectedReturn), new Date()) &&
    c.status !== 'inserted' &&
    c.status !== 'cancelled'
  )
}

function computeStats(cases: LabCaseLite[]) {
  const completed = cases.filter((c) => c.status === 'inserted')
  const completedCount = completed.length
  const activeCount = cases.filter((c) => ACTIVE_STATUSES.includes(c.status)).length
  const dueTodayCount = cases.filter(isDueToday).length
  const overdueCount = cases.filter(isOverdue).length

  // Turnaround = sent → inserted (period the case is out at the vendor).
  const turnarounds = completed
    .map((c) =>
      c.sentAt && c.insertedAt
        ? (new Date(c.insertedAt).getTime() - new Date(c.sentAt).getTime()) / DAY_MS
        : null
    )
    .filter((d): d is number => d !== null && d >= 0)
  const avgTurnaroundDays = turnarounds.length
    ? Math.round((turnarounds.reduce((sum, d) => sum + d, 0) / turnarounds.length) * 10) / 10
    : 0

  // On-time = completed on/before the expectedReturn deadline.
  const withDeadline = completed.filter((c) => c.insertedAt && c.expectedReturn)
  const onTime = withDeadline.filter(
    (c) => new Date(c.insertedAt as string) <= new Date(c.expectedReturn as string)
  )
  const onTimeRatePct = withDeadline.length
    ? Math.round((onTime.length / withDeadline.length) * 100)
    : 0

  // Rework proxy: completed cases flagged with a delay reason.
  const reworked = completed.filter((c) => c.delayReason).length
  const reworkRatePct = completedCount ? Math.round((reworked / completedCount) * 100) : 0

  return {
    activeCount,
    dueTodayCount,
    overdueCount,
    completedCount,
    avgTurnaroundDays,
    onTimeRatePct,
    reworkRatePct,
  }
}

const EMPTY = {
  activeCount: 0,
  dueTodayCount: 0,
  overdueCount: 0,
  completedCount: 0,
  avgTurnaroundDays: 0,
  onTimeRatePct: 0,
  reworkRatePct: 0,
}

export default function LabHomePage() {
  const { user } = useAuth()
  const [stats, setStats] = useState(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    labApi
      .getCases()
      .then((res) => {
        // GET /api/labs/cases → { success, data: LabCase[], total, ... }
        if (res.success && Array.isArray(res.data)) {
          setStats(computeStats(res.data as LabCaseLite[]))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="page-enter space-y-3 p-5">
        <div className="skeleton h-24 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="page-enter space-y-3 p-5">
      <WelcomeCard name={user?.name?.split(' ')?.[0] || 'Lab Tech'} subtitle="Lab Technician" />

      {/* Overdue — surfaced first for urgency when there's anything to action.
          Count sits as a big badge in the top-right corner of the card. */}
      {stats.overdueCount > 0 && (
        <Link
          to="/lab/jobs?filter=overdue"
          className="relative flex items-center gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 transition-colors hover:border-red-400"
        >
          <span className="absolute -right-2 -top-2 inline-flex h-8 min-w-[32px] items-center justify-center rounded-full bg-red-600 px-2.5 text-base font-bold leading-none text-white shadow-md ring-2 ring-white">
            {stats.overdueCount}
          </span>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-900">
              {stats.overdueCount} overdue {stats.overdueCount === 1 ? 'case' : 'cases'}
            </p>
            <p className="text-xs text-red-700/80">Past expected return — needs attention now</p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-red-400" />
        </Link>
      )}

      {/* Live queue */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          tone="brand"
          icon={FlaskConical}
          value={stats.activeCount}
          label="Active cases"
          to="/lab/jobs"
          chevron
        />
        <StatCard
          tone="amber"
          icon={CalendarClock}
          value={stats.dueTodayCount}
          label="Due today"
          to="/lab/jobs?filter=due-today"
          chevron
        />
      </div>

      {/* Performance */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          tone="emerald"
          icon={CheckCircle2}
          value={stats.completedCount}
          label="Cases completed"
        />
        <StatCard
          tone="sky"
          icon={Timer}
          value={`${stats.avgTurnaroundDays}d`}
          label="Avg turnaround"
        />
        <StatCard
          tone="violet"
          icon={Target}
          value={`${stats.onTimeRatePct}%`}
          label="On-time rate"
        />
        <StatCard
          tone="rose"
          icon={Repeat2}
          value={`${stats.reworkRatePct}%`}
          label="Rework rate"
        />
      </div>

      {/* Into the bench */}
      <NavCard
        tone="indigo"
        icon={FlaskConical}
        title="Lab Jobs"
        subtitle="See and update all active submissions"
        to="/lab/jobs"
      />
    </div>
  )
}
