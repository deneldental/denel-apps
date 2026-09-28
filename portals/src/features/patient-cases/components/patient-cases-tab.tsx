import { format } from 'date-fns'
import { ChevronRight, FolderOpen, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PatientCase = {
  id: string
  caseNumber: string
  status: 'open' | 'closed'
  planId?: string | null
  chiefComplaint: string | null
  createdAt: string
  createdBy: { id: string; name: string } | null
  closedAt: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  patientId: string
  canEdit?: boolean
}

export function PatientCasesTab({ patientId, canEdit = true }: Props) {
  const navigate = useNavigate()
  const [cases, setCases] = useState<PatientCase[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = statusFilter !== 'all' ? `?status=${statusFilter}` : ''
    const res = await api.get<PatientCase[]>(`/api/patient-cases/patient/${patientId}${params}`)
    if (res.success && res.data) setCases(res.data as PatientCase[])
    setLoading(false)
  }, [patientId, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate() {
    setCreating(true)
    const res = await api.post<PatientCase>('/api/patient-cases', { patientId })
    if (res.success && res.data) {
      toast.success('Case created')
      const newCase = res.data as PatientCase
      navigate(`/patients/${patientId}/cases/${newCase.id}`)
    } else {
      toast.error((res.error as string) ?? 'Failed to create case')
      setCreating(false)
    }
  }

  function openCase(id: string) {
    navigate(`/patients/${patientId}/cases/${id}`)
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cases</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        {canEdit && (
          <Button size="sm" onClick={handleCreate} disabled={creating}>
            <Plus className="h-4 w-4 mr-1.5" />
            New case
          </Button>
        )}
      </div>

      {/* Table */}
      {cases.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
          <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-medium text-muted-foreground">No cases yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Create a case to start recording medical history.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[130px]">Case ID</TableHead>
                <TableHead>Linked Plan</TableHead>
                <TableHead className="w-[90px]">Status</TableHead>
                <TableHead className="w-[130px]">Created</TableHead>
                <TableHead className="w-[120px]">Doctor</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => openCase(c.id)}>
                  <TableCell className="font-mono text-xs font-semibold">{c.caseNumber}</TableCell>
                  <TableCell className="text-sm max-w-xs truncate">
                    {c.planId ? (
                      <Badge
                        variant="secondary"
                        className="cursor-pointer hover:bg-secondary/80"
                        onClick={(e) => {
                          e.stopPropagation()
                          // We emit an event or navigate to the plan. Currently,
                          // the user would manually navigate, or we link to the plans tab.
                          // Without a dedicated plan link route specified, we'll just show the ID.
                          toast.info(`Linked Plan ID: ${c.planId!.slice(0, 8)}...`)
                        }}
                      >
                        Plan Linked
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground/50 italic">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        c.status === 'open'
                          ? 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-900 dark:bg-emerald-950/30'
                          : 'text-muted-foreground'
                      }
                    >
                      {c.status === 'open' ? 'Open' : 'Closed'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(c.createdAt), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="text-sm">{c.createdBy?.name ?? '—'}</TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
