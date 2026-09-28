import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  BellOff,
  Check,
  CheckCircle2,
  Circle,
  ClipboardList,
  Loader2,
  Megaphone,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { acknowledgeMemo, getMyMemos, type StaffMemo } from '@/lib/actions/notifications'
import { getMyTasks, type MyTask, setTaskStatus } from '@/lib/actions/tasks'
import { useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

const PRIORITY_VARIANT: Record<MyTask['priority'], 'secondary' | 'default' | 'destructive'> = {
  low: 'secondary',
  normal: 'secondary',
  high: 'default',
  urgent: 'destructive',
}

const LEVEL_TONE: Record<string, string> = {
  info: 'border-l-sky-400',
  warning: 'border-l-amber-400',
  urgent: 'border-l-destructive',
  critical: 'border-l-destructive',
}

function fmtDate(input: string | null): string {
  if (!input) return ''
  try {
    return new Date(input).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

function fmtRelative(input: string | null): string {
  if (!input) return ''
  try {
    return formatDistanceToNow(new Date(input), { addSuffix: true })
  } catch {
    return ''
  }
}

// Date-only due dates are stored at midnight; a task is overdue only once its
// whole due day has passed (matches the HR/Team apps).
function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false
  try {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    return new Date(dueAt).getTime() < startOfToday.getTime()
  } catch {
    return false
  }
}

/**
 * Strip HTML so memo bodies authored in the rich editor preview as plain text.
 * DOMParser builds an inert document — no scripts run and no subresources load —
 * so memo markup never touches the live DOM.
 */
function plainText(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

/**
 * Notifications — the Activity page's second tab. Two feeds the signed-in user
 * actually has to act on: tasks assigned to them (HR Tasks Management) and
 * published staff memos targeted at them. Both are read from endpoints that
 * already exist; memos are optional (portal users without a staff record get a
 * 401, which we swallow and render as "no memos").
 */
const MY_TASKS_KEY = ['activity', 'my-tasks'] as const
const MY_MEMOS_KEY = ['activity', 'my-memos'] as const

export function NotificationsPanel() {
  const queryClient = useQueryClient()
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [busyMemoId, setBusyMemoId] = useState<string | null>(null)

  const tasksQuery = useApiQuery(MY_TASKS_KEY, () => getMyTasks())
  // A missing staff record (401) is expected for some portal users — treat it
  // as an empty memo feed rather than an error.
  const memosQuery = useApiQuery(MY_MEMOS_KEY, () => getMyMemos())
  const tasks = tasksQuery.data ?? []
  const memos = memosQuery.data ?? []
  const loading = tasksQuery.isLoading || memosQuery.isLoading

  async function toggleTask(task: MyTask) {
    if (busyTaskId) return
    const done = task.status !== 'done'
    setBusyTaskId(task.assignmentId)
    const res = await setTaskStatus(task.assignmentId, done)
    setBusyTaskId(null)
    if (!res.success) {
      toast.error(res.error || 'Failed to update task')
      return
    }
    queryClient.setQueryData<MyTask[]>(MY_TASKS_KEY, (prev) =>
      (prev ?? []).map((t) =>
        t.assignmentId === task.assignmentId
          ? {
              ...t,
              status: done ? 'done' : 'pending',
              doneAt: done ? new Date().toISOString() : null,
            }
          : t
      )
    )
  }

  async function ackMemo(memo: StaffMemo) {
    if (busyMemoId) return
    setBusyMemoId(memo.id)
    const res = await acknowledgeMemo(memo.id)
    setBusyMemoId(null)
    if (!res.success) {
      toast.error(res.error || 'Failed to acknowledge memo')
      return
    }
    queryClient.setQueryData<StaffMemo[]>(MY_MEMOS_KEY, (prev) =>
      (prev ?? []).map((m) => (m.id === memo.id ? { ...m, acknowledged: true } : m))
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const pendingTasks = tasks.filter((t) => t.status !== 'done')
  const unreadMemos = memos.filter((m) => !m.acknowledged)

  if (pendingTasks.length === 0 && memos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
        <BellOff className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">You're all caught up.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Tasks */}
      {pendingTasks.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">My tasks</CardTitle>
            <Badge variant="secondary">{pendingTasks.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingTasks.map((t) => (
              <div key={t.assignmentId} className="flex items-start gap-3 rounded-md border p-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-0.5 h-6 w-6 shrink-0"
                  onClick={() => toggleTask(t)}
                  disabled={busyTaskId === t.assignmentId}
                  aria-label="Mark task done"
                >
                  {busyTaskId === t.assignmentId ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </Button>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.title}</span>
                    <Badge variant={PRIORITY_VARIANT[t.priority]} className="capitalize">
                      {t.priority}
                    </Badge>
                    {isOverdue(t.dueAt) && <Badge variant="destructive">Overdue</Badge>}
                  </div>
                  {t.description && (
                    <p className="text-sm text-muted-foreground">{t.description}</p>
                  )}
                  {t.dueAt && (
                    <p className="text-xs text-muted-foreground">Due {fmtDate(t.dueAt)}</p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Memos */}
      {memos.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
            <Megaphone className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Memos & announcements</CardTitle>
            {unreadMemos.length > 0 && <Badge variant="secondary">{unreadMemos.length} new</Badge>}
          </CardHeader>
          <CardContent className="space-y-2">
            {memos.map((m) => {
              const body = plainText(m.content)
              return (
                <div
                  key={m.id}
                  className={`rounded-md border border-l-4 p-3 ${LEVEL_TONE[m.level] ?? 'border-l-border'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m.title}</span>
                        <Badge variant="outline" className="text-xs capitalize">
                          {m.memoType.replace('_', ' ')}
                        </Badge>
                        {!m.acknowledged && <Badge variant="default">New</Badge>}
                      </div>
                      {body && (
                        <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{body}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {m.audience} · {fmtRelative(m.createdAt)}
                      </p>
                    </div>
                    {m.acknowledged ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Read
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={busyMemoId === m.id}
                        onClick={() => ackMemo(m)}
                      >
                        {busyMemoId === m.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Mark read
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
