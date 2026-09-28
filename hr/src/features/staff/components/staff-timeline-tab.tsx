import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@denel/ui'
import { format, parseISO } from 'date-fns'
import {
  Clock,
  FileText,
  GraduationCap,
  History,
  Inbox,
  ListChecks,
  Loader2,
  Megaphone,
  Star,
  UserCog,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'
import { getStaffTimeline, type TimelineEvent, type TimelineEventType } from '@/lib/actions/staff'

const PAGE_SIZE = 50

const EVENT_STYLE: Record<
  TimelineEventType,
  { icon: ComponentType<{ className?: string }>; cls: string }
> = {
  attendance: {
    icon: Clock,
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  document: {
    icon: FileText,
    cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  training: {
    icon: GraduationCap,
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  assessment: {
    icon: Star,
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  request: {
    icon: Inbox,
    cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  },
  lifecycle: {
    icon: UserCog,
    cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  },
  task: {
    icon: ListChecks,
    cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  },
  memo: {
    icon: Megaphone,
    cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
}

function fmtTime(ts: string): string {
  try {
    return format(parseISO(ts), 'HH:mm')
  } catch {
    return ''
  }
}

function dayKey(ts: string): string {
  try {
    return format(parseISO(ts), 'yyyy-MM-dd')
  } catch {
    return ts.slice(0, 10)
  }
}

function dayLabel(key: string): string {
  try {
    return format(parseISO(key), 'EEEE, MMMM d, yyyy')
  } catch {
    return key
  }
}

export function StaffTimelineTab({ staffId }: { staffId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getStaffTimeline(staffId, { limit: PAGE_SIZE, offset: 0 })
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) {
          setEvents(res.data.events)
          setHasMore(res.data.hasMore)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [staffId])

  async function loadMore() {
    setLoadingMore(true)
    const res = await getStaffTimeline(staffId, { limit: PAGE_SIZE, offset: events.length })
    if (res.success && res.data) {
      const d = res.data
      setEvents((prev) => [...prev, ...d.events])
      setHasMore(d.hasMore)
    }
    setLoadingMore(false)
  }

  // Group the (already newest-first) events into day buckets, preserving order.
  const groups: Array<{ key: string; events: TimelineEvent[] }> = []
  for (const ev of events) {
    const key = dayKey(ev.timestamp)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.events.push(ev)
    else groups.push({ key, events: [ev] })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Timeline</CardTitle>
          <CardDescription>
            Everything that's happened for this staff member — attendance, training, documents,
            requests, tasks and more, newest first.
          </CardDescription>
        </div>
        <History className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No activity recorded yet.
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {dayLabel(g.key)}
                </p>
                <ul className="space-y-2 border-l pl-4">
                  {g.events.map((ev) => {
                    const style = EVENT_STYLE[ev.eventType]
                    const Icon = style.icon
                    return (
                      <li key={ev.id} className="relative flex items-start gap-3">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.cls} [&>svg]:h-3.5 [&>svg]:w-3.5`}
                        >
                          <Icon />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug">{ev.title}</p>
                          {ev.description && (
                            <p className="text-xs text-muted-foreground">{ev.description}</p>
                          )}
                        </div>
                        <Badge variant="outline" className="shrink-0 text-[10px] tabular-nums">
                          {fmtTime(ev.timestamp)}
                        </Badge>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}

            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
