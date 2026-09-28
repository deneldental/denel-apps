import { Button, Checkbox } from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { format, isBefore, parseISO, startOfDay } from 'date-fns'
import { CheckCircle2, Trash2 } from 'lucide-react'
import type { MyTaskRow, TaskPriority, TaskRow } from '@/lib/actions/tasks'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { StatusBadge, type StatusTone } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'

const PRIORITY_TONE: Record<TaskPriority, StatusTone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
  urgent: 'danger',
}

function fmt(input: string | null | undefined, pattern = 'MMM d'): string {
  if (!input) return ''
  try {
    return format(parseISO(input), pattern)
  } catch {
    return ''
  }
}

function isOverdue(dueAt: string | null, done: boolean): boolean {
  if (!dueAt || done) return false
  try {
    // Due dates are date-only (stored at midnight). A task is overdue only once
    // its whole due day has passed — not from midnight of the day it's due.
    return isBefore(parseISO(dueAt), startOfDay(new Date()))
  } catch {
    return false
  }
}

/** Columns for the admin "All tasks" table. */
export function buildAllTaskColumns(opts: {
  onDelete: (id: string) => void
}): ColumnDef<TaskRow>[] {
  return [
    {
      accessorKey: 'title',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Task" />,
      cell: ({ row }) => {
        const t = row.original
        return (
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t.title}</span>
              {t.repeat !== 'none' && (
                <TagBadge label={t.repeat} className="capitalize">
                  {t.repeat}
                </TagBadge>
              )}
            </div>
            {t.description && (
              <p className="max-w-md truncate text-xs text-muted-foreground">{t.description}</p>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'priority',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Priority" />,
      cell: ({ row }) => (
        <StatusBadge tone={PRIORITY_TONE[row.original.priority]}>
          {row.original.priority}
        </StatusBadge>
      ),
    },
    {
      id: 'progress',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Progress" />,
      accessorFn: (t) => (t.assigneeCount > 0 ? t.doneCount / t.assigneeCount : 0),
      cell: ({ row }) => {
        const t = row.original
        return (
          <div className="space-y-1.5">
            <span className="text-sm font-medium tabular-nums">
              {t.doneCount}/{t.assigneeCount} done
            </span>
            <div className="flex flex-wrap gap-1.5">
              {t.assignees.map((a) => (
                <StatusBadge
                  key={a.id}
                  tone={a.status === 'done' ? 'success' : 'neutral'}
                  className="gap-1 text-[11px] font-normal normal-case"
                >
                  {a.status === 'done' && <CheckCircle2 className="h-3 w-3" />}
                  {a.name}
                  {a.isSelf ? ' (me)' : ''}
                </StatusBadge>
              ))}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'dueAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
      cell: ({ row }) => {
        const t = row.original
        const allDone = t.assigneeCount > 0 && t.doneCount === t.assigneeCount
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t.dueAt ? fmt(t.dueAt) : '—'}</span>
            {isOverdue(t.dueAt, allDone) && <StatusBadge tone="danger">Overdue</StatusBadge>}
          </div>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => opts.onDelete(row.original.id)}
          aria-label="Delete task"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      ),
    },
  ]
}

/** Columns for the "My tasks" table (with a done checkbox). */
export function buildMyTaskColumns(opts: {
  onToggle: (assignmentId: string, done: boolean) => void
}): ColumnDef<MyTaskRow>[] {
  return [
    {
      id: 'done',
      cell: ({ row }) => {
        const done = row.original.status === 'done'
        return (
          <Checkbox
            checked={done}
            onCheckedChange={(v) => opts.onToggle(row.original.assignmentId, v === true)}
            aria-label="Mark done"
          />
        )
      },
    },
    {
      accessorKey: 'title',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Task" />,
      cell: ({ row }) => {
        const t = row.original
        const done = t.status === 'done'
        return (
          <div className="min-w-0 space-y-1">
            <span className={done ? 'font-medium line-through opacity-60' : 'font-medium'}>
              {t.title}
            </span>
            {t.description && (
              <p className="max-w-md truncate text-xs text-muted-foreground">{t.description}</p>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'priority',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Priority" />,
      cell: ({ row }) => (
        <StatusBadge tone={PRIORITY_TONE[row.original.priority]}>
          {row.original.priority}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'dueAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
      cell: ({ row }) => {
        const t = row.original
        const done = t.status === 'done'
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t.dueAt ? fmt(t.dueAt) : '—'}</span>
            {isOverdue(t.dueAt, done) && <StatusBadge tone="danger">Overdue</StatusBadge>}
          </div>
        )
      },
    },
  ]
}
