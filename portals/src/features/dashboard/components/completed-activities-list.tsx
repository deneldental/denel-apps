import { formatDistanceToNow } from 'date-fns'
import { RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type CompletedActivity,
  getCompletedActivities,
  uncompleteActivity,
} from '@/lib/actions/activities'
import { useApiMutation } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'

// admin-v1 §1.1/§3.3 — the Completed tab: paginated history from activity_completions.

const TYPE_LABEL: Record<string, string> = {
  recare: 'Recare',
  patient_reminder: 'Reminder',
  birthday: 'Birthday',
  unconfirmed: 'Unconfirmed',
  overdue: 'Overdue',
}
const PAGE = 10

export function CompletedActivitiesList() {
  const [rows, setRows] = useState<CompletedActivity[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (off: number, append: boolean) => {
    setLoading(true)
    const res = await getCompletedActivities({ limit: PAGE, offset: off })
    if (res.success && res.data) {
      const data = res.data
      setRows((prev) => (append ? [...prev, ...data] : data))
      setTotal((res as unknown as { total?: number }).total ?? data.length)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load(0, false)
  }, [load])

  const undoMutation = useApiMutation((id: string) => uncompleteActivity(id))

  async function undo(id: string) {
    try {
      await undoMutation.mutateAsync(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      setTotal((t) => Math.max(0, t - 1))
      toast.success('Moved back to pending')
    } catch {
      toast.error('Failed to undo')
    }
  }

  if (loading && rows.length === 0) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-muted-foreground text-sm">No completed activities yet.</p>
    )
  }
  return (
    <div className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm">
              {r.label ?? TYPE_LABEL[r.activityType] ?? r.activityType}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {TYPE_LABEL[r.activityType] ?? r.activityType}
              {r.completedByName ? ` · ${r.completedByName}` : ''} ·{' '}
              {formatDistanceToNow(new Date(r.completedAt), { addSuffix: true })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => undo(r.id)}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Undo
          </Button>
        </div>
      ))}
      {rows.length < total && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          disabled={loading}
          onClick={() => {
            const next = offset + PAGE
            setOffset(next)
            load(next, true)
          }}
        >
          {loading ? 'Loading…' : `Load more (${rows.length}/${total})`}
        </Button>
      )}
    </div>
  )
}
