import { format } from 'date-fns'
import { Activity, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { formatAmount } from '@/shared/utils/currency'

// ─── Types ────────────────────────────────────────────────────────────────────

type TimelineEvent = {
  id: string
  patientId: string
  eventType: string
  referenceType: string | null
  referenceId: string | null
  title: string
  description: string | null
  amount: number | null
  createdAt: string
  appointmentType: string | null
  createdBy: { id: string; name: string } | null
}

type DayGroup = {
  dateKey: string
  displayDate: string
  appointmentType: string | null
  events: TimelineEvent[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PatientTimelineTab({ patientId }: { patientId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const load = useCallback(
    async (p: number) => {
      setLoading(true)
      const res = await api.get<{
        data: TimelineEvent[]
        meta: { page: number; totalPages: number; total: number }
      }>(`/api/patient-timeline/${patientId}?page=${p}`)
      if (res.success && res.data) {
        // Handle both legacy flat array and new paginated envelope
        const raw = res.data as any
        const evts: TimelineEvent[] = Array.isArray(raw) ? raw : (raw.data ?? [])
        const meta = Array.isArray(raw)
          ? { page: 1, totalPages: 1 }
          : (raw.meta ?? { page: 1, totalPages: 1 })
        setEvents(evts)
        setTotalPages(meta.totalPages)
        setPage(meta.page)
      }
      setLoading(false)
    },
    [patientId]
  )

  useEffect(() => {
    load(1)
  }, [load])

  // Group events into day buckets
  const dayGroups: DayGroup[] = []
  const seen: Record<string, number> = {}
  for (const event of events) {
    const dateKey = format(new Date(event.createdAt), 'yyyy-MM-dd')
    if (seen[dateKey] === undefined) {
      seen[dateKey] = dayGroups.length
      dayGroups.push({
        dateKey,
        displayDate: format(new Date(dateKey), 'EEEE, MMMM d, yyyy'),
        appointmentType: event.appointmentType,
        events: [],
      })
    }
    const grp = dayGroups[seen[dateKey]]
    // Pick up appointment type from any appointment event in the group
    if (!grp.appointmentType && event.appointmentType) grp.appointmentType = event.appointmentType
    grp.events.push(event)
  }

  // Keep the most-recent (first) group expanded by default on every load.
  // Re-asserted each time `events` changes so it stays open after pagination
  // / refresh. The user can still collapse it manually; a subsequent load
  // will re-open it.
  const mostRecentKey = dayGroups[0]?.dateKey
  useEffect(() => {
    if (!mostRecentKey) return
    setExpandedKeys((prev) => {
      if (prev.has(mostRecentKey)) return prev
      const next = new Set(prev)
      next.add(mostRecentKey)
      return next
    })
  }, [mostRecentKey])

  function toggleGroup(dateKey: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(dateKey)) next.delete(dateKey)
      else next.add(dateKey)
      return next
    })
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (events.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <Activity className="h-10 w-10 text-muted-foreground/40" />
        <div>
          <p className="font-medium text-muted-foreground">Nothing available</p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Patient activity will appear here as appointments, treatments, and payments are
            recorded.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-end pb-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          onClick={() => load(page)}
          disabled={loading}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Accordion groups */}
      <div className="space-y-2 overflow-y-auto pr-1 pb-1" style={{ maxHeight: '60vh' }}>
        {dayGroups.map((group) => {
          const isOpen = expandedKeys.has(group.dateKey)
          return (
            <div
              key={group.dateKey}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              {/* Accordion header */}
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                onClick={() => toggleGroup(group.dateKey)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <p className="text-sm font-semibold truncate">{group.displayDate}</p>
                  {group.appointmentType && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-4 px-1.5 shrink-0 capitalize"
                    >
                      {group.appointmentType.replace(/-/g, ' ')}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground shrink-0">
                    {group.events.length} {group.events.length === 1 ? 'event' : 'events'}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200',
                    isOpen && 'rotate-180'
                  )}
                />
              </button>

              {/* Accordion body — compact visit summary */}
              {isOpen && (
                <div className="border-t border-border px-4 py-3 space-y-1.5">
                  {group.events.map((event) => {
                    const isOutflow =
                      event.amount != null &&
                      ['wallet_debit', 'invoice_issued'].includes(event.eventType)
                    return (
                      <div key={event.id} className="flex items-center justify-between gap-3">
                        <p className="text-xs text-foreground/80 leading-snug truncate">
                          {event.title}
                        </p>
                        {event.amount != null && (
                          <span
                            className={cn(
                              'text-xs font-mono tabular-nums shrink-0',
                              isOutflow
                                ? 'text-destructive'
                                : 'text-emerald-600 dark:text-emerald-400'
                            )}
                          >
                            {isOutflow ? '−' : '+'}GHS {formatAmount(Math.abs(event.amount))}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page <= 1}
              onClick={() => load(page - 1)}
              aria-label="Previous"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page >= totalPages}
              onClick={() => load(page + 1)}
              aria-label="Next"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
