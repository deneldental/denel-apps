import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatCard,
} from '@denel/ui'
import { cn } from '@denel/utils'
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns'
import {
  AlertTriangle,
  Cake,
  CalendarOff,
  CheckSquare,
  ClipboardList,
  Clock,
  Gift,
  GraduationCap,
  Inbox,
  ListChecks,
  Loader2,
  type LucideIcon,
  PartyPopper,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AssignTaskSheet } from '@/features/tasks/components/assign-task-sheet'
import { getActiveLifecycleTasks, type LifecycleTask } from '@/lib/actions/hr-phase2-4'
import {
  type AdminLearner,
  type AttendanceMonthlyRow,
  getAllLearnersAdmin,
  getAttendance,
  getHrDashboard,
  getRawAttendanceEvents,
  getRecentRequests,
  type HrDashboardData,
  type RawAttendanceEvent,
  type RecentRequestRow,
} from '@/lib/actions/staff'
import { useAuth } from '@/lib/auth'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'

// Keep every overview list short so the page stays scannable — details live on
// each card's own page (via the "View all" link).
const MAX_ROWS = 5

function formatDate(input: string | null | undefined, pattern = 'MMM d, yyyy'): string {
  if (!input) return '—'
  try {
    return format(parseISO(input), pattern)
  } catch {
    return '—'
  }
}

/**
 * `attendanceEvents.rawStatus` is whatever the punch source supplied, verbatim:
 *
 *  - Anviz webhook (`backend/src/routes/staff-attendance.ts`) stores the device's
 *    numeric `check_type` as a STRING — `"0"`, `"1"`, … `"0"` is truthy, so a
 *    bare `{ev.rawStatus && …}` guard rendered a meaningless "0" under every
 *    name on this dashboard.
 *  - CSV ingestion (`backend/src/lib/attendance.ts`) keeps column 5 of the file,
 *    which is free text and varies by export template.
 *
 * So: resolve on VALUE, never on truthiness. Anything not in the known set is
 * a raw device code we cannot describe, and is suppressed rather than shown.
 */
const RAW_STATUS_LABELS: Record<string, string> = {
  // Anviz / ZKTeco check_type codes.
  '0': 'Check in',
  '1': 'Check out',
  '2': 'Break out',
  '3': 'Break in',
  '4': 'Overtime in',
  '5': 'Overtime out',
  // Word forms seen from CSV exports.
  check_in: 'Check in',
  checkin: 'Check in',
  check_out: 'Check out',
  checkout: 'Check out',
  break_out: 'Break out',
  break_in: 'Break in',
  overtime_in: 'Overtime in',
  overtime_out: 'Overtime out',
  in: 'Check in',
  out: 'Check out',
}

/** Human label for a raw device status, or `null` when it is not recognised. */
function attendanceStatusLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return RAW_STATUS_LABELS[key] ?? null
}

// PR-19 — birthdays are stored as separate day/month ints so HR doesn't keep
// the year on file. Format directly without round-tripping through a Date.
function formatDayMonth(day: number | null, month: number | null): string {
  if (!day || !month || month < 1 || month > 12) return '—'
  const probe = new Date(2024, month - 1, day)
  return format(probe, 'MMM d')
}

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// ── Per-card colour tones ─────────────────────────────────────────────────────
// A soft tinted surface + a solid icon chip + colour-matched title/link, mirroring
// the Team and Patient home screens. Class strings are spelled out statically so
// Tailwind's scanner emits them; each is dark-mode aware so list rows stay legible.
const SECTION_TONES = {
  sky: {
    card: 'border-sky-200/70 from-sky-50/80 to-sky-100/30 dark:border-sky-900/40 dark:from-sky-950/40 dark:to-sky-900/10',
    chip: 'bg-sky-600 text-white',
    title: 'text-sky-800 dark:text-sky-200',
    link: 'text-sky-700 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300',
  },
  amber: {
    card: 'border-amber-200/70 from-amber-50/80 to-amber-100/30 dark:border-amber-900/40 dark:from-amber-950/40 dark:to-amber-900/10',
    chip: 'bg-amber-600 text-white',
    title: 'text-amber-800 dark:text-amber-200',
    link: 'text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300',
  },
  emerald: {
    card: 'border-emerald-200/70 from-emerald-50/80 to-emerald-100/30 dark:border-emerald-900/40 dark:from-emerald-950/40 dark:to-emerald-900/10',
    chip: 'bg-emerald-600 text-white',
    title: 'text-emerald-800 dark:text-emerald-200',
    link: 'text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300',
  },
  violet: {
    card: 'border-violet-200/70 from-violet-50/80 to-violet-100/30 dark:border-violet-900/40 dark:from-violet-950/40 dark:to-violet-900/10',
    chip: 'bg-violet-600 text-white',
    title: 'text-violet-800 dark:text-violet-200',
    link: 'text-violet-700 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300',
  },
  rose: {
    card: 'border-rose-200/70 from-rose-50/80 to-rose-100/30 dark:border-rose-900/40 dark:from-rose-950/40 dark:to-rose-900/10',
    chip: 'bg-rose-600 text-white',
    title: 'text-rose-800 dark:text-rose-200',
    link: 'text-rose-700 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300',
  },
  indigo: {
    card: 'border-indigo-200/70 from-indigo-50/80 to-indigo-100/30 dark:border-indigo-900/40 dark:from-indigo-950/40 dark:to-indigo-900/10',
    chip: 'bg-indigo-600 text-white',
    title: 'text-indigo-800 dark:text-indigo-200',
    link: 'text-indigo-700 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300',
  },
  teal: {
    card: 'border-teal-200/70 from-teal-50/80 to-teal-100/30 dark:border-teal-900/40 dark:from-teal-950/40 dark:to-teal-900/10',
    chip: 'bg-teal-600 text-white',
    title: 'text-teal-800 dark:text-teal-200',
    link: 'text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300',
  },
  purple: {
    card: 'border-purple-200/70 from-purple-50/80 to-purple-100/30 dark:border-purple-900/40 dark:from-purple-950/40 dark:to-purple-900/10',
    chip: 'bg-purple-600 text-white',
    title: 'text-purple-800 dark:text-purple-200',
    link: 'text-purple-700 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300',
  },
  orange: {
    card: 'border-orange-200/70 from-orange-50/80 to-orange-100/30 dark:border-orange-900/40 dark:from-orange-950/40 dark:to-orange-900/10',
    chip: 'bg-orange-600 text-white',
    title: 'text-orange-800 dark:text-orange-200',
    link: 'text-orange-700 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300',
  },
  cyan: {
    card: 'border-cyan-200/70 from-cyan-50/80 to-cyan-100/30 dark:border-cyan-900/40 dark:from-cyan-950/40 dark:to-cyan-900/10',
    chip: 'bg-cyan-600 text-white',
    title: 'text-cyan-800 dark:text-cyan-200',
    link: 'text-cyan-700 hover:text-cyan-800 dark:text-cyan-400 dark:hover:text-cyan-300',
  },
} as const

type SectionTone = keyof typeof SECTION_TONES

/** Colour-toned card shell: icon chip + title + description, with an optional
 *  "View all" link to the full page. The list itself is passed as children. */
function ListCard({
  tone,
  icon: Icon,
  title,
  description,
  viewAllTo,
  children,
}: {
  tone: SectionTone
  icon: LucideIcon
  title: string
  description: ReactNode
  viewAllTo?: string
  children: ReactNode
}) {
  const t = SECTION_TONES[tone]
  return (
    <Card className={cn('bg-gradient-to-br', t.card)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm [&>svg]:h-4 [&>svg]:w-4',
              t.chip
            )}
          >
            <Icon />
          </span>
          <div className="min-w-0">
            <CardTitle className={cn('text-base', t.title)}>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        {viewAllTo && (
          <Link
            to={viewAllTo}
            className={cn(
              'mt-0.5 shrink-0 whitespace-nowrap text-xs font-medium hover:underline',
              t.link
            )}
          >
            View all →
          </Link>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export default function HrDashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [data, setData] = useState<HrDashboardData | null>(null)
  const [lifecycle, setLifecycle] = useState<LifecycleTask[]>([])
  const [requests, setRequests] = useState<RecentRequestRow[]>([])
  const [learners, setLearners] = useState<AdminLearner[]>([])
  const [attendance, setAttendance] = useState<AttendanceMonthlyRow[]>([])
  const [rawEvents, setRawEvents] = useState<RawAttendanceEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const month = format(new Date(), 'yyyy-MM')
    ;(async () => {
      const [res, lc, reqs, lrn, att, raw] = await Promise.all([
        getHrDashboard(),
        getActiveLifecycleTasks(),
        getRecentRequests(),
        getAllLearnersAdmin(),
        getAttendance(month, 'all'),
        getRawAttendanceEvents(),
      ])
      if (cancelled) return
      if (!res.success || !res.data) {
        setError(res.error || 'Failed to load HR dashboard')
      } else {
        setData(res.data)
      }
      if (lc.success && Array.isArray(lc.data)) setLifecycle(lc.data)
      if (reqs.success && Array.isArray(reqs.data)) setRequests(reqs.data)
      if (lrn.success && Array.isArray(lrn.data)) setLearners(lrn.data)
      if (att.success && Array.isArray(att.data)) setAttendance(att.data)
      if (raw.success && Array.isArray(raw.data)) setRawEvents(raw.data)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Derived widget data ───────────────────────────────────────────────────
  const topAttendance = useMemo(
    () =>
      [...attendance]
        .filter((r) => r.tracksAttendance && r.scoringDays > 0)
        .sort((a, b) => b.attendancePct - a.attendancePct)
        .slice(0, MAX_ROWS),
    [attendance]
  )

  const topTraining = useMemo(
    () =>
      learners
        .map((l) => {
          const mods = l.progressByModule ?? []
          const total = mods.length
          const completed = mods.filter((m) => m.status === 'completed').length
          const avg = total
            ? Math.round(mods.reduce((s, m) => s + (m.progressPercent || 0), 0) / total)
            : 0
          return { id: l.id, name: l.name, completed, total, avg }
        })
        .filter((x) => x.total > 0)
        .sort((a, b) => b.completed - a.completed || b.avg - a.avg)
        .slice(0, MAX_ROWS),
    [learners]
  )

  const lastChecks = useMemo(() => rawEvents.slice(0, MAX_ROWS), [rawEvents])

  const latestRequests = useMemo(
    () =>
      [...requests]
        .sort((a, b) => {
          const ta = new Date(a.submittedAt || a.createdAt || 0).getTime()
          const tb = new Date(b.submittedAt || b.createdAt || 0).getTime()
          return tb - ta
        })
        .slice(0, MAX_ROWS),
    [requests]
  )

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>HR Dashboard unavailable</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const expiringCount = data.expiringCredentials.length
  const expiredCount = data.expiringCredentials.filter((c) => c.status === 'expired').length
  const pendingTotal = data.pending.requests + data.pending.profileChanges
  const firstName = user?.name?.split(' ')[0] || 'there'

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ── Welcome hero + primary actions ───────────────────────────────── */}
      <div className="flex flex-col gap-4 rounded-2xl border bg-gradient-to-br from-slate-50 to-slate-100/40 p-6 dark:from-slate-800/40 dark:to-slate-900/20 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {greetingFor(new Date().getHours())}, {firstName} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(new Date(), 'EEEE, MMMM d')} · Headcount, attendance, and what needs attention.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate('/staff?new=1')}>
            <UserPlus className="mr-2 h-4 w-4" />
            New Staff
          </Button>
          <Button variant="outline" onClick={() => setAssignOpen(true)}>
            <ListChecks className="mr-2 h-4 w-4" />
            Assign Task
          </Button>
        </div>
      </div>

      {/* ── Colorful stat cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/staff" className="block">
          <StatCard
            title="Active staff"
            value={data.headcount.activeTotal}
            icon={<Users />}
            variant="blue"
          />
        </Link>
        <Link to="/requests" className="block">
          <StatCard
            title="Pending requests"
            value={pendingTotal}
            icon={<Inbox />}
            hint={`${data.pending.requests} HR · ${data.pending.profileChanges} profile`}
            variant="amber"
          />
        </Link>
        <Link
          to={
            data.expiringCredentials.length === 1 && data.expiringCredentials[0].staffId
              ? `/staff/${data.expiringCredentials[0].staffId}?tab=credentials`
              : '/staff?filter=expiring-credentials'
          }
          className="block"
        >
          <StatCard
            title="Expiring credentials"
            value={expiringCount}
            icon={<AlertTriangle />}
            hint={expiredCount > 0 ? `${expiredCount} already expired` : 'In the next 60 days'}
            variant={expiredCount > 0 ? 'rose' : 'amber'}
          />
        </Link>
        <Link to="/requests" className="block">
          <StatCard
            title="Out this week"
            value={data.whosOutThisWeek.length}
            icon={<CalendarOff />}
            hint={`Week of ${formatDate(data.weekStart, 'MMM d')}`}
            variant="purple"
          />
        </Link>
      </div>

      {/* ── Activity widgets ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent attendance checks */}
        <ListCard
          tone="sky"
          icon={Clock}
          title="Recent attendance checks"
          description="Most recent clock-ins from the device."
          viewAllTo="/attendance"
        >
          {lastChecks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attendance events yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {lastChecks.map((ev) => {
                const statusLabel = attendanceStatusLabel(ev.rawStatus)
                return (
                  <li key={ev.id} className="flex items-center justify-between py-2">
                    <div className="min-w-0">
                      {ev.staffId ? (
                        <Link
                          to={`/staff/${ev.staffId}?tab=attendance`}
                          className="block truncate text-sm font-medium hover:underline"
                        >
                          {ev.staffName ?? ev.deviceUserName ?? 'Unknown'}
                        </Link>
                      ) : (
                        <span className="block truncate text-sm font-medium">
                          {ev.staffName ?? ev.deviceUserName ?? `Device #${ev.deviceUserId}`}
                        </span>
                      )}
                      {statusLabel !== null && (
                        <p className="truncate text-xs text-muted-foreground">{statusLabel}</p>
                      )}
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(ev.eventTimestamp, 'MMM d, HH:mm')}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </ListCard>

        {/* Latest requests */}
        <ListCard
          tone="amber"
          icon={Inbox}
          title="Latest requests"
          description="Newest submissions across the team."
          viewAllTo="/requests"
        >
          {latestRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests submitted.</p>
          ) : (
            <ul className="divide-y divide-border">
              {latestRequests.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {r.staff?.fullName ?? 'Unknown staff'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground capitalize">
                      {(r.subType || r.requestType || '').replace(/_/g, ' ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={r.status} className="text-[10px]" />
                    <span className="text-xs text-muted-foreground">
                      {formatDate(r.submittedAt || r.createdAt, 'MMM d')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ListCard>

        {/* Top attendance */}
        <ListCard
          tone="emerald"
          icon={TrendingUp}
          title="Top attendance"
          description={`Best attendance rate this month (${format(new Date(), 'MMMM')}).`}
          viewAllTo="/attendance"
        >
          {topAttendance.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attendance scored yet this month.</p>
          ) : (
            <ul className="divide-y divide-border">
              {topAttendance.map((row, i) => (
                <li key={row.staffId} className="flex items-center justify-between py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <Link
                      to={`/staff/${row.staffId}?tab=attendance`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {row.fullName}
                    </Link>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">
                      {Math.round(row.attendancePct)}%
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.daysPresent}/{row.scoringDays}d
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ListCard>

        {/* Top training */}
        <ListCard
          tone="violet"
          icon={GraduationCap}
          title="Top training performers"
          description="Most modules completed."
          viewAllTo="/trainer/learners"
        >
          {topTraining.length === 0 ? (
            <p className="text-sm text-muted-foreground">No training progress yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {topTraining.map((row, i) => (
                <li key={row.id} className="flex items-center justify-between py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <span className="truncate text-sm font-medium">{row.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">
                      {row.completed}/{row.total}
                    </span>
                    <span className="text-xs text-muted-foreground">{row.avg}% avg</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ListCard>
      </div>

      {/* ── Attention widgets ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Expiring credentials */}
        <ListCard
          tone="rose"
          icon={ClipboardList}
          title="Expiring credentials"
          description="Lapses and upcoming renewals (next 60 days)."
          viewAllTo="/staff?filter=expiring-credentials"
        >
          {data.expiringCredentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing expiring soon.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.expiringCredentials.slice(0, MAX_ROWS).map((cred) => (
                <li key={cred.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <Link
                      to={`/staff/${cred.staffId}?tab=credentials`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {cred.staffName ?? 'Unknown staff'}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {cred.credentialName} · {cred.credentialType}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusBadge
                      tone={cred.status === 'expired' ? 'danger' : 'warning'}
                      className="text-[10px]"
                    >
                      {cred.status === 'expired' ? 'Expired' : 'Expires'}
                    </StatusBadge>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(cred.expiryDate)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ListCard>

        {/* Who's out this week */}
        <ListCard
          tone="indigo"
          icon={CalendarOff}
          title="Out this week"
          description={`Approved leaves overlapping ${formatDate(data.weekStart, 'MMM d')} – ${formatDate(data.weekEnd, 'MMM d')}.`}
          viewAllTo="/requests"
        >
          {data.whosOutThisWeek.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everyone is on deck.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.whosOutThisWeek.slice(0, MAX_ROWS).map((row) => (
                <li key={row.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <Link
                      to={`/staff/${row.staffId}?tab=attendance`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {row.staffName ?? 'Unknown'}
                    </Link>
                    <p className="text-xs text-muted-foreground capitalize">
                      {row.subType?.replace(/_/g, ' ') || row.requestType}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(row.startDate, 'MMM d')}
                    {row.endDate ? ` – ${formatDate(row.endDate, 'MMM d')}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </ListCard>

        {/* Recent new hires */}
        <ListCard
          tone="teal"
          icon={UserPlus}
          title="Recent new hires"
          description="Onboarded in the last 30 days."
          viewAllTo="/staff"
        >
          {data.recentNewHires.length === 0 ? (
            <p className="text-sm text-muted-foreground">No new hires this month.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.recentNewHires.slice(0, MAX_ROWS).map((hire) => (
                <li key={hire.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <Link
                      to={`/staff/${hire.id}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {hire.fullName}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {hire.position || 'No position set'}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {hire.dateOfJoining
                      ? `Joined ${formatDistanceToNowStrict(parseISO(hire.dateOfJoining), {
                          addSuffix: true,
                        })}`
                      : '—'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </ListCard>

        {/* Upcoming anniversaries */}
        <ListCard
          tone="purple"
          icon={PartyPopper}
          title="Upcoming anniversaries"
          description="Work anniversaries in the next 30 days."
          viewAllTo="/staff"
        >
          {data.upcomingAnniversaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to celebrate this month.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.upcomingAnniversaries.slice(0, MAX_ROWS).map((row) => (
                <li key={row.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <Link
                      to={`/staff/${row.id}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {row.fullName}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{row.position || ''}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Cake className="h-3 w-3" />
                    {row.dateOfJoining ? formatDate(row.dateOfJoining, 'MMM d') : '—'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ListCard>

        {/* Upcoming birthdays */}
        {data.upcomingBirthdays && (
          <ListCard
            tone="orange"
            icon={Gift}
            title="Upcoming birthdays"
            description="Birthdays in the next 30 days."
            viewAllTo="/staff"
          >
            {data.upcomingBirthdays.length === 0 ? (
              <p className="text-sm text-muted-foreground">No birthdays this month.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.upcomingBirthdays.slice(0, MAX_ROWS).map((row) => (
                  <li key={row.id} className="flex items-center justify-between py-2">
                    <div className="min-w-0">
                      <Link
                        to={`/staff/${row.id}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {row.fullName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{row.position || ''}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Cake className="h-3 w-3" />
                      {formatDayMonth(row.birthDay, row.birthMonth)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ListCard>
        )}

        {/* Active lifecycle tasks */}
        <ListCard
          tone="cyan"
          icon={CheckSquare}
          title="Lifecycle tasks in flight"
          description="Onboarding / offboarding tasks not yet complete. Overdue items are flagged."
          viewAllTo="/staff"
        >
          {lifecycle.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active lifecycle tasks.</p>
          ) : (
            <ul className="divide-y divide-border">
              {lifecycle.slice(0, MAX_ROWS).map((row) => (
                <li key={row.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <Link
                      to={`/staff/${row.staffId}?tab=lifecycle`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {row.staffName ?? 'Staff'} · {row.label}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground capitalize">
                      {row.kind.replace(/_/g, ' ')} · {row.status.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    {row.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
                    <span className="text-muted-foreground">
                      {row.dueAt ? formatDate(row.dueAt, 'MMM d') : '—'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ListCard>
      </div>

      {/* ── Staff type breakdown ─────────────────────────────────────────── */}
      {Object.keys(data.headcount.byStaffType).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Headcount by staff type</CardTitle>
            <CardDescription>Active staff, excluding soft-deleted records.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {Object.entries(data.headcount.byStaffType).map(([type, count]) => (
                <TagBadge key={type} label={type} className="capitalize">
                  {type}: {count}
                </TagBadge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AssignTaskSheet open={assignOpen} onOpenChange={setAssignOpen} />
    </div>
  )
}
