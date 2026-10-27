import { Avatar, AvatarFallback, Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNow } from 'date-fns'
import { Loader2, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CreateModuleSheet } from '@/features/trainer/CreateModuleSheet'
import { trainerApi } from '@/lib/actions/trainer'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'

/**
 * Training hub — the single home for all training authoring, replacing the
 * former standalone Modules / Assessments / Learners pages. Each tab is a
 * standardized <DataTable> with clickable rows that open the item's detail
 * route (module authoring, learner progress, submission grading).
 */
const TABS = ['modules', 'assessments', 'learners'] as const
type TabValue = (typeof TABS)[number]

export default function TrainingPage() {
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: TabValue = (TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as TabValue)
    : 'modules'

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Training</h1>
        <p className="text-muted-foreground mt-1">
          Author modules and assessments, review submissions, and track learner progress.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setParams({ tab: v }, { replace: true })}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="modules">Modules</TabsTrigger>
          <TabsTrigger value="assessments">Assessments</TabsTrigger>
          <TabsTrigger value="learners">Learners</TabsTrigger>
        </TabsList>

        <TabsContent value="modules" className="mt-4">
          <ModulesTab />
        </TabsContent>
        <TabsContent value="assessments" className="mt-4">
          <AssessmentsTab />
        </TabsContent>
        <TabsContent value="learners" className="mt-4">
          <LearnersTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading…
    </div>
  )
}

// ── Modules ─────────────────────────────────────────────────────────────────

interface TrainingModule {
  id: string
  title: string
  description: string | null
  published: boolean
  updatedAt: string
  materialType?: 'module' | 'quiz' | string
  progress?: { id: string }[]
}

function ModulesTab() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<TrainingModule[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    trainerApi
      .getModules()
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setRows(res.data as TrainingModule[])
      })
      .finally(() => setLoading(false))
  }, [])

  const columns = useMemo<ColumnDef<TrainingModule>[]>(
    () => [
      {
        accessorKey: 'title',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-sm text-foreground">{row.original.title}</p>
            {row.original.description && (
              <p className="truncate text-xs text-muted-foreground">{row.original.description}</p>
            )}
          </div>
        ),
      },
      {
        id: 'type',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        accessorFn: (m) => (m.materialType === 'quiz' ? 'Assessment' : 'Module'),
        cell: ({ getValue }) => <TagBadge className="text-[10px]">{getValue<string>()}</TagBadge>,
      },
      {
        id: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        accessorFn: (m) => (m.published ? 'published' : 'draft'),
        cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
      },
      {
        id: 'learners',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Learners" />,
        accessorFn: (m) => m.progress?.length ?? 0,
        cell: ({ getValue }) => <span className="tabular-nums text-sm">{getValue<number>()}</span>,
      },
      {
        accessorKey: 'updatedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(row.original.updatedAt), { addSuffix: true })}
          </span>
        ),
      },
    ],
    []
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New module
        </Button>
      </div>
      {loading ? (
        <LoadingState />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          meta={{ onRowClick: (m: TrainingModule) => navigate(`/trainer/modules/${m.id}`) }}
        />
      )}
      <CreateModuleSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => navigate(`/trainer/modules/${id}`)}
      />
    </div>
  )
}

// ── Assessments ─────────────────────────────────────────────────────────────

type AssessmentStatus = 'pending' | 'reviewed'

interface AssessmentRow {
  id: string
  staffId: string
  learnerName: string | null
  trainingId: string
  moduleName: string
  score: number | null
  completedAt: string | null
  reviewedAt: string | null
  trainerFeedback: string | null
  attemptsCount: number
  status: AssessmentStatus
}

function AssessmentsTab() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<AssessmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    trainerApi
      .getAssessments()
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setRows(res.data as AssessmentRow[])
        else toast.error(res.error || 'Failed to load submissions')
      })
      .finally(() => setLoading(false))
  }, [])

  const columns = useMemo<ColumnDef<AssessmentRow>[]>(
    () => [
      {
        accessorKey: 'learnerName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Learner" />,
        cell: ({ row }) => (
          <span className="font-medium text-sm">{row.original.learnerName ?? 'Unknown'}</span>
        ),
      },
      {
        accessorKey: 'moduleName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Assessment" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.moduleName}</span>
        ),
      },
      {
        accessorKey: 'score',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Score" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-sm">
            {typeof row.original.score === 'number' ? row.original.score : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'attemptsCount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Attempts" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-sm">{row.original.attemptsCount ?? 1}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusBadge tone={row.original.status === 'reviewed' ? 'success' : 'warning'}>
            {row.original.status === 'reviewed' ? 'Reviewed' : 'Pending'}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'completedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Completed" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.completedAt
              ? formatDistanceToNow(new Date(row.original.completedAt), { addSuffix: true })
              : '—'}
          </span>
        ),
      },
    ],
    []
  )

  const pendingCount = rows.filter((r) => r.status === 'pending').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{pendingCount} awaiting review</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New assessment
        </Button>
      </div>
      {loading ? (
        <LoadingState />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          meta={{ onRowClick: (a: AssessmentRow) => navigate(`/trainer/assessments/${a.id}`) }}
        />
      )}
      <CreateModuleSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => navigate(`/trainer/modules/${id}`)}
        initialKind="quiz"
        lockKind
      />
    </div>
  )
}

// ── Learners ────────────────────────────────────────────────────────────────

interface LearnerProgress {
  trainingId: string
  title: string
  status: string
  progressPercent: number
  score?: number | null
  completedAt?: string | null
}

interface Learner {
  id: string
  name: string
  email: string
  role: string
  progressByModule: LearnerProgress[]
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function lastActivityAt(progress: LearnerProgress[]): string | null {
  const completed = progress.filter((p) => p.completedAt)
  if (completed.length === 0) return null
  return completed.reduce((a, b) =>
    new Date(a.completedAt as string) > new Date(b.completedAt as string) ? a : b
  ).completedAt as string
}

function LearnersTab() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Learner[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    trainerApi
      .getLearners()
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setRows(res.data as Learner[])
      })
      .finally(() => setLoading(false))
  }, [])

  const columns = useMemo<ColumnDef<Learner>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Learner" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                {initialsOf(row.original.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium text-sm">{row.original.name}</p>
              <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
        cell: ({ row }) => (
          <TagBadge className="text-[10px] capitalize">{row.original.role}</TagBadge>
        ),
      },
      {
        id: 'modules',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Modules" />,
        accessorFn: (l) => l.progressByModule.length,
        cell: ({ getValue }) => <span className="tabular-nums text-sm">{getValue<number>()}</span>,
      },
      {
        id: 'lastActivity',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last activity" />,
        accessorFn: (l) => lastActivityAt(l.progressByModule) ?? '',
        cell: ({ getValue }) => {
          const iso = getValue<string>()
          return (
            <span className="text-xs text-muted-foreground">
              {iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : '—'}
            </span>
          )
        },
      },
    ],
    []
  )

  return loading ? (
    <LoadingState />
  ) : (
    <DataTable
      columns={columns}
      data={rows}
      meta={{ onRowClick: (l: Learner) => navigate(`/trainer/learners/${l.id}`) }}
    />
  )
}
