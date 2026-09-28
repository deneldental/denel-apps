import { StatCard } from '@denel/ui/blocks'
import { Calendar, CheckCircle2, Circle, ClipboardList, Loader2, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { staffApi } from '@/lib/api'
import { cn } from '@/lib/utils'

interface MyTask {
  assignmentId: string
  status: 'pending' | 'done'
  doneAt: string | null
  id: string
  title: string
  description: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  dueAt: string | null
}

const PRIORITY_VARIANT: Record<MyTask['priority'], 'secondary' | 'default' | 'destructive'> = {
  low: 'secondary',
  normal: 'secondary',
  high: 'default',
  urgent: 'destructive',
}

function fmtDate(input: string | null): string {
  if (!input) return ''
  try {
    return new Date(input).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

function isOverdue(dueAt: string | null, done: boolean): boolean {
  if (!dueAt || done) return false
  try {
    return new Date(dueAt).getTime() < Date.now()
  } catch {
    return false
  }
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<MyTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const res = await staffApi.getMyTasks()
    if (res.success && Array.isArray(res.data)) {
      setTasks(res.data as MyTask[])
      setError(null)
    } else {
      setError(res.error || 'Failed to load tasks')
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function toggle(task: MyTask) {
    if (busyId) return
    const done = task.status !== 'done'
    setBusyId(task.assignmentId)
    const res = await staffApi.setTaskStatus(task.assignmentId, done)
    if (res.success) {
      setTasks((prev) =>
        prev.map((t) =>
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
    setBusyId(null)
  }

  const pending = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 p-4 pb-20">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Tasks assigned to you. Tap to mark done.
        </p>
      </div>

      {!loading && !error && tasks.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            tone="amber"
            icon={ClipboardList}
            value={pending.length}
            label="Pending tasks"
          />
          <StatCard tone="emerald" icon={CheckCircle2} value={done.length} label="Completed" />
          <StatCard
            tone="violet"
            icon={TrendingUp}
            value={tasks.length > 0 ? `${Math.round((done.length / tasks.length) * 100)}%` : '100%'}
            label="Completion"
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">You have no tasks right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map((t) => (
                <TaskCard
                  key={t.assignmentId}
                  task={t}
                  busy={busyId === t.assignmentId}
                  onToggle={toggle}
                />
              ))}
            </div>
          )}
          {done.length > 0 && (
            <div className="space-y-2">
              <p className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Completed ({done.length})
              </p>
              {done.map((t) => (
                <TaskCard
                  key={t.assignmentId}
                  task={t}
                  busy={busyId === t.assignmentId}
                  onToggle={toggle}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TaskCard({
  task,
  busy,
  onToggle,
}: {
  task: MyTask
  busy: boolean
  onToggle: (t: MyTask) => void
}) {
  const done = task.status === 'done'
  const overdue = isOverdue(task.dueAt, done)

  const tone: 'emerald' | 'brand' | 'sky' = done
    ? 'emerald'
    : task.priority === 'urgent' || task.priority === 'high' || overdue
      ? 'brand'
      : 'sky'

  const t = {
    emerald: {
      card: 'border-emerald-100 bg-emerald-50 text-emerald-950 hover:border-emerald-200',
      chip: 'text-emerald-600',
      text: 'text-emerald-950',
      muted: 'text-emerald-800/80',
    },
    brand: {
      card: 'border-brand/20 bg-brand/5 text-foreground hover:border-brand/30',
      chip: 'text-brand',
      text: 'text-foreground',
      muted: 'text-muted-foreground',
    },
    sky: {
      card: 'border-sky-100 bg-sky-50 text-sky-950 hover:border-sky-200',
      chip: 'text-sky-600',
      text: 'text-sky-950',
      muted: 'text-sky-800/80',
    },
  }[tone]

  return (
    <div
      className={cn(
        'relative flex items-start gap-3 rounded-2xl border p-4 transition-all duration-200 cursor-pointer hover:shadow-xs active:scale-[0.99]',
        t.card,
        done && 'opacity-70'
      )}
      onClick={() => onToggle(task)}
    >
      <Button
        variant="ghost"
        size="icon"
        className="mt-0.5 h-6 w-6 shrink-0"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          onToggle(task)
        }}
        aria-label={done ? 'Mark not done' : 'Mark done'}
      >
        {busy ? (
          <Loader2 className={cn('h-5 w-5 animate-spin', t.chip)} />
        ) : done ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : (
          <Circle className={cn('h-5 w-5', t.chip)} />
        )}
      </Button>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'font-bold text-sm leading-snug',
              t.text,
              done && 'line-through opacity-60'
            )}
          >
            {task.title}
          </span>
          <Badge
            variant={PRIORITY_VARIANT[task.priority]}
            className="capitalize text-[9px] h-4 font-bold border-none px-1.5"
          >
            {task.priority}
          </Badge>
          {overdue && (
            <Badge variant="destructive" className="text-[9px] h-4 font-bold border-none px-1.5">
              Overdue
            </Badge>
          )}
        </div>
        {task.description && (
          <p className={cn('text-xs leading-relaxed', t.muted)}>{task.description}</p>
        )}
        {task.dueAt && (
          <div
            className={cn(
              'flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider',
              t.muted
            )}
          >
            <Calendar size={11} />
            <span>Due {fmtDate(task.dueAt)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
