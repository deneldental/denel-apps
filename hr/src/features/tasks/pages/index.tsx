import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@denel/ui'
import { ListChecks, Loader2, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  deleteTask,
  getMyTasks,
  listTasks,
  type MyTaskRow,
  setAssignmentStatus,
  type TaskRow,
} from '@/lib/actions/tasks'
import { DataTable } from '@/shared/components/data-table/data-table'
import { AssignTaskSheet } from '../components/assign-task-sheet'
import { buildAllTaskColumns, buildMyTaskColumns } from '../components/tasks-columns'

// The table paginates client-side, so pull a generous window in one request
// rather than the old incremental "Load more". Task volumes are modest (one
// clinic's operational to-dos), so a single fetch is simpler and lets the
// DataTable own filtering + pagination.
const FETCH_LIMIT = 200

export default function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [tab, setTab] = useState('all')
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [myTasks, setMyTasks] = useState<MyTaskRow[]>([])
  const [tasksTotal, setTasksTotal] = useState(0)
  const [myTotal, setMyTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // `silent` refetches (after a toggle/delete/create) skip the full-page spinner
  // so the current tab is preserved.
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    const [all, mine] = await Promise.all([
      listTasks({ limit: FETCH_LIMIT }),
      getMyTasks({ limit: FETCH_LIMIT }),
    ])
    if (all.success && Array.isArray(all.data)) {
      setTasks(all.data)
      setTasksTotal(typeof all.total === 'number' ? all.total : all.data.length)
    }
    if (mine.success && Array.isArray(mine.data)) {
      setMyTasks(mine.data)
      setMyTotal(typeof mine.total === 'number' ? mine.total : mine.data.length)
    }
    if (!opts?.silent) setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Deep-link from the Overview "Assign Task" button: /tasks?assign=1
  useEffect(() => {
    if (searchParams.get('assign') !== null) {
      setDialogOpen(true)
      searchParams.delete('assign')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const handleToggleDone = useCallback(
    async (assignmentId: string, done: boolean) => {
      const res = await setAssignmentStatus(assignmentId, done ? 'done' : 'pending')
      if (res.success) {
        setMyTasks((prev) =>
          prev.map((t) =>
            t.assignmentId === assignmentId
              ? {
                  ...t,
                  status: done ? 'done' : 'pending',
                  doneAt: done ? new Date().toISOString() : null,
                }
              : t
          )
        )
        void load({ silent: true })
      } else {
        toast.error(res.error || 'Failed to update task')
      }
    },
    [load]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await deleteTask(id)
      if (res.success) {
        // Drop from BOTH lists — a self-assigned task also lives in "My tasks",
        // whose assignment is cascade-deleted server-side.
        const wasMine = myTasks.some((t) => t.id === id)
        setTasks((prev) => prev.filter((t) => t.id !== id))
        setMyTasks((prev) => prev.filter((t) => t.id !== id))
        setTasksTotal((n) => Math.max(0, n - 1))
        if (wasMine) setMyTotal((n) => Math.max(0, n - 1))
        toast.success('Task deleted')
      } else {
        toast.error(res.error || 'Failed to delete task')
      }
    },
    [myTasks]
  )

  const allColumns = useMemo(() => buildAllTaskColumns({ onDelete: handleDelete }), [handleDelete])
  const myColumns = useMemo(
    () => buildMyTaskColumns({ onToggle: handleToggleDone }),
    [handleToggleDone]
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks Management</h1>
          <p className="text-sm text-muted-foreground">
            Assign tasks to staff or yourself — they're notified by SMS + in-app alert.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Assign Task
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All tasks ({tasksTotal})</TabsTrigger>
            <TabsTrigger value="mine">My tasks ({myTotal})</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4">
            {tasks.length === 0 ? <EmptyState /> : <DataTable columns={allColumns} data={tasks} />}
          </TabsContent>

          <TabsContent value="mine" className="mt-4">
            {myTasks.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                You have no tasks assigned to you.
              </p>
            ) : (
              <DataTable columns={myColumns} data={myTasks} />
            )}
          </TabsContent>
        </Tabs>
      )}

      <AssignTaskSheet
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => load({ silent: true })}
      />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <ListChecks className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">No tasks yet. Assign one to get started.</p>
    </div>
  )
}
