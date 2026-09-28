import { format, isBefore } from 'date-fns'
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Loader2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { labApi } from '@/lib/api'

interface LabCase {
  id: string
  caseNumber: string
  patientId: string
  serviceName: string
  status: string
  expectedReturn: string | null
  createdAt: string
  notes: string | null
  patient: { id: string; name: string } | null
  vendor: { id: string; name: string; type: string } | null
}

type Group = 'all' | 'active' | 'completed'
type SortKey = 'due-asc' | 'due-desc' | 'status' | 'recent'
type QuickFilter = 'overdue' | 'due-today' | null

const ACTIVE_STATUSES = ['sent', 'in_progress', 'received', 'ready_for_insertion']
const COMPLETED_STATUSES = ['inserted', 'cancelled']
const PAGE_SIZE = 8

// Fallback labels (keys are canonical; the admin config overrides these via the
// stage's displayName — see labelByName in the component).
const STATUS_LABELS: Record<string, string> = {
  draft: 'Ordered',
  sent: 'Dispatched',
  in_progress: 'In Progress',
  received: 'Shipped',
  ready_for_insertion: 'Ready',
  inserted: 'Inserted',
  cancelled: 'Cancelled',
  delayed: 'Delayed',
}

// Card accent: a left border stripe + subtle tint keyed to status, so the queue
// reads at a glance. Badge keeps the stronger fill.
const STATUS_ACCENT: Record<string, { bar: string; tint: string; badge: string }> = {
  draft: { bar: 'border-l-gray-300', tint: 'bg-gray-50', badge: 'bg-gray-100 text-gray-600' },
  sent: {
    bar: 'border-l-purple-400',
    tint: 'bg-purple-50/50',
    badge: 'bg-purple-100 text-purple-700',
  },
  in_progress: {
    bar: 'border-l-yellow-400',
    tint: 'bg-yellow-50/50',
    badge: 'bg-yellow-100 text-yellow-800',
  },
  received: { bar: 'border-l-blue-400', tint: 'bg-blue-50/50', badge: 'bg-blue-100 text-blue-700' },
  ready_for_insertion: {
    bar: 'border-l-green-400',
    tint: 'bg-green-50/50',
    badge: 'bg-green-100 text-green-700',
  },
  inserted: {
    bar: 'border-l-emerald-500',
    tint: 'bg-emerald-50/50',
    badge: 'bg-emerald-100 text-emerald-700',
  },
  cancelled: { bar: 'border-l-red-400', tint: 'bg-red-50/50', badge: 'bg-red-100 text-red-700' },
  delayed: {
    bar: 'border-l-orange-400',
    tint: 'bg-orange-50/50',
    badge: 'bg-orange-100 text-orange-700',
  },
}

const DEFAULT_ACCENT = {
  bar: 'border-l-gray-300',
  tint: 'bg-card',
  badge: 'bg-gray-100 text-gray-600',
}

const SORT_ORDER = [
  'received',
  'in_progress',
  'ready_for_insertion',
  'sent',
  'draft',
  'inserted',
  'cancelled',
]

function isOverdue(c: LabCase): boolean {
  return (
    c.expectedReturn != null &&
    isBefore(new Date(c.expectedReturn), new Date()) &&
    c.status !== 'inserted' &&
    c.status !== 'cancelled'
  )
}

function isDueToday(c: LabCase): boolean {
  if (!c.expectedReturn || c.status === 'inserted' || c.status === 'cancelled') return false
  const d = new Date(c.expectedReturn)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function daysLeftLabel(expectedReturn: string | null): { text: string; overdue: boolean } | null {
  if (!expectedReturn) return null
  const now = new Date()
  const due = new Date(expectedReturn)
  const diff = Math.round((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, overdue: true }
  if (diff === 0) return { text: 'Due today', overdue: false }
  return { text: `${diff}d left`, overdue: false }
}

export default function LabJobsPage() {
  const [cases, setCases] = useState<LabCase[]>([])
  const [labelByName, setLabelByName] = useState<Record<string, string>>({})
  const [group, setGroup] = useState<Group>('active')
  const [sort, setSort] = useState<SortKey>('due-asc')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useSearchParams()
  const quick = (params.get('filter') as QuickFilter) ?? null

  // Admin-configured labels win over the built-in fallbacks.
  const statusLabel = (status: string): string =>
    labelByName[status] ??
    STATUS_LABELS[status] ??
    status.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())

  useEffect(() => {
    labApi
      .getCases()
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setCases(res.data as LabCase[])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    labApi.getCaseStatuses().then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setLabelByName(
          Object.fromEntries(
            (res.data as Array<{ name: string; displayName: string }>).map((s) => [
              s.name,
              s.displayName,
            ])
          )
        )
      }
    })
  }, [])

  // Reset to first page whenever the filter/sort changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: page reset on filter change
  useEffect(() => setPage(0), [group, sort, quick])

  const filtered = useMemo(() => {
    let list = cases
    if (quick === 'overdue') list = list.filter(isOverdue)
    else if (quick === 'due-today') list = list.filter(isDueToday)
    else if (group === 'active') list = list.filter((c) => ACTIVE_STATUSES.includes(c.status))
    else if (group === 'completed') list = list.filter((c) => COMPLETED_STATUSES.includes(c.status))

    const sorted = [...list].sort((a, b) => {
      switch (sort) {
        case 'due-asc':
        case 'due-desc': {
          const av = a.expectedReturn
            ? new Date(a.expectedReturn).getTime()
            : Number.POSITIVE_INFINITY
          const bv = b.expectedReturn
            ? new Date(b.expectedReturn).getTime()
            : Number.POSITIVE_INFINITY
          return sort === 'due-asc' ? av - bv : bv - av
        }
        case 'status':
          return SORT_ORDER.indexOf(a.status) - SORT_ORDER.indexOf(b.status)
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }
    })
    return sorted
  }, [cases, group, quick, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const pageItems = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  const clearQuick = () => {
    params.delete('filter')
    setParams(params, { replace: true })
  }

  return (
    <div className="pb-24">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical className="h-5 w-5" />
          <h1 className="text-xl font-bold">Lab Jobs</h1>
        </div>
        <p className="text-xs text-muted-foreground">Cases assigned across the bench.</p>
      </div>

      {/* Quick-filter banner (from Home links) */}
      {quick && (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={clearQuick}
            className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700"
          >
            {quick === 'overdue' ? 'Overdue only' : 'Due today only'}
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Group chips + sort */}
      <div className="px-4 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          {(['all', 'active', 'completed'] as Group[]).map((g) => (
            <Chip
              key={g}
              active={!quick && group === g}
              onClick={() => {
                clearQuick()
                setGroup(g)
              }}
            >
              {g === 'all' ? 'All' : g === 'active' ? 'Active' : 'Completed'}
            </Chip>
          ))}
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-8 w-auto gap-1 border-none bg-muted px-3 text-xs">
            <ArrowUpDown className="h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="due-asc">Due soonest</SelectItem>
            <SelectItem value="due-desc">Due latest</SelectItem>
            <SelectItem value="status">By status</SelectItem>
            <SelectItem value="recent">Recently added</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="px-4 pt-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : pageItems.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <FlaskConical className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No cases in this view.</p>
            </CardContent>
          </Card>
        ) : (
          pageItems.map((c) => {
            const accent = STATUS_ACCENT[c.status] ?? DEFAULT_ACCENT
            const terminal = COMPLETED_STATUSES.includes(c.status)
            const overdue = isOverdue(c)
            // Days-left/overdue urgency only makes sense for in-flight cases;
            // a Delivered/Cancelled case just shows its date.
            const dleft = terminal ? null : daysLeftLabel(c.expectedReturn)
            return (
              <Link key={c.id} to={`/lab/jobs/${c.id}`} className="block">
                <div
                  className={`flex items-center gap-3 rounded-lg border border-l-4 ${accent.bar} ${accent.tint} px-3 py-2.5 transition-colors hover:border-primary/40`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {c.caseNumber}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${accent.badge}`}
                      >
                        {statusLabel(c.status)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm font-semibold leading-tight">
                      {c.serviceName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.patient?.name ?? 'Unknown patient'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {terminal ? (
                      <span className="text-xs text-muted-foreground">
                        {c.expectedReturn ? format(new Date(c.expectedReturn), 'MMM d') : '—'}
                      </span>
                    ) : dleft ? (
                      <>
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium ${overdue ? 'text-red-600' : 'text-muted-foreground'}`}
                        >
                          {overdue && <AlertTriangle className="h-3 w-3" />}
                          {dleft.text}
                        </span>
                        {c.expectedReturn && (
                          <p className="text-[10px] text-muted-foreground/70">
                            {format(new Date(c.expectedReturn), 'MMM d')}
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">No date</span>
                    )}
                  </div>
                </div>
              </Link>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {!loading && filtered.length > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between px-4">
          <p className="text-xs text-muted-foreground">
            {current * PAGE_SIZE + 1}–{Math.min((current + 1) * PAGE_SIZE, filtered.length)} of{' '}
            {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={current === 0}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-1 text-xs tabular-nums text-muted-foreground">
              {current + 1}/{pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={current >= pageCount - 1}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
