import { formatDistanceToNow } from 'date-fns'
import { Archive, ChevronRight, FolderOpen, MoreHorizontal, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
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
import { ClinicalPagination } from './clinical-pagination'
import { ClinicalTreatmentPlanSheet } from './clinical-treatment-plan-sheet'
import { PatientPickerDialog } from './patient-picker-dialog'

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25

// ─── Types ────────────────────────────────────────────────────────────────────

type ClinicalCase = {
  id: string
  caseNumber: string
  status: 'open' | 'closed'
  chiefComplaint: string | null
  createdAt: string
  closedAt: string | null
  patient: { id: string; name: string; patientId: string | null }
  createdBy: { id: string; name: string } | null
  plan: { id: string; title: string } | null
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  canEdit?: boolean
  isAdmin?: boolean
}

export function ClinicalCasesTab({ canEdit = true, isAdmin = false }: Props) {
  const navigate = useNavigate()
  const [cases, setCases] = useState<ClinicalCase[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('open')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectedPatient, setSelectedPatient] = useState<{
    id: string
    name: string
    patientId: string | null
  } | null>(null)

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // §5.1 — reset to page 1 whenever the filter or search term changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed off filter/search, not page
  useEffect(() => {
    setPage(1)
  }, [statusFilter, debouncedSearch])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (debouncedSearch) params.set('search', debouncedSearch)
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    params.set('limit', String(PAGE_SIZE))
    const res = await api.get<ClinicalCase[]>(`/api/patient-cases?${params}`)
    if (res.success && res.data) setCases(res.data as ClinicalCase[])
    setLoading(false)
  }, [statusFilter, debouncedSearch, page])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreateCase(patient: { id: string; name: string; patientId: string | null }) {
    setCreating(true)
    const res = await api.post<{ id: string }>('/api/patient-cases', { patientId: patient.id })
    if (res.success && res.data) {
      toast.success('Case created')
      navigate(`/patients/${patient.id}/cases/${(res.data as { id: string }).id}`, {
        state: { from: '/clinical/cases' },
      })
    } else {
      toast.error((res.error as string) ?? 'Failed to create case')
      setCreating(false)
    }
  }

  function openCase(c: ClinicalCase) {
    navigate(`/patients/${c.patient.id}/cases/${c.id}`, { state: { from: '/clinical/cases' } })
  }

  async function handleDelete() {
    if (!deleteId) return
    const res = await api.delete(`/api/patient-cases/${deleteId}`)
    if (res.success) {
      toast.success('Case archived')
      setCases((prev) => prev.filter((c) => c.id !== deleteId))
    } else {
      toast.error('Failed to delete case')
    }
    setDeleteId(null)
  }

  // Permanently delete removed per requirements

  return (
    <div className="p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by case # or patient name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-xs text-sm"
        />
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
        <div className="flex-1" />
        {canEdit && (
          <Button size="sm" onClick={() => setPickerOpen(true)} disabled={creating}>
            <Plus className="h-4 w-4 mr-1.5" />
            New case
          </Button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : cases.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-medium text-muted-foreground">No cases found</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {search || statusFilter !== 'all'
                ? 'Try adjusting your filters.'
                : 'Create a case to get started.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[130px]">Case #</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Treatment Plan</TableHead>
                <TableHead className="w-[90px]">Status</TableHead>
                <TableHead className="w-[130px]">Doctor</TableHead>
                <TableHead className="w-[140px]">Created</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => openCase(c)}>
                  <TableCell className="font-mono text-xs font-semibold">{c.caseNumber}</TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{c.patient.name}</p>
                      {c.patient.patientId && (
                        <p className="text-xs text-muted-foreground font-mono">
                          {c.patient.patientId}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">
                    {c.plan ? (
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium text-left truncate w-full"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedPlanId(c.plan?.id ?? null)
                          setSelectedPatient(c.patient)
                        }}
                      >
                        {c.plan.title}
                      </button>
                    ) : (
                      <span className="text-muted-foreground/50 italic">No plan</span>
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
                  <TableCell className="text-sm">{c.createdBy?.name ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span title={new Date(c.createdAt).toLocaleString()}>
                      {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                    </span>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {isAdmin ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="More options"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openCase(c)}>
                            <ChevronRight className="h-3.5 w-3.5 mr-2" />
                            View details
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteId(c.id)}
                          >
                            <Archive className="h-3.5 w-3.5 mr-2" />
                            Archive case
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* §5.1 — server-side pagination */}
      {!loading && cases.length > 0 && (
        <ClinicalPagination
          page={page}
          pageSize={PAGE_SIZE}
          rowCount={cases.length}
          onPageChange={setPage}
        />
      )}

      {/* Patient picker → new case */}
      <PatientPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleCreateCase}
        title="Select patient for new case"
      />

      {/* Soft-delete (archive) confirmation */}
      <DeleteConfirmationDialog
        open={!!deleteId}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null)
        }}
        onConfirm={handleDelete}
        title="Archive case"
        description="The case is hidden from clinical views but kept for audit."
      />

      {/* Plan Sheet Viewer */}
      {selectedPlanId && selectedPatient && (
        <ClinicalTreatmentPlanSheet
          planId={selectedPlanId}
          patient={selectedPatient}
          open={!!selectedPlanId}
          onOpenChange={(o) => !o && setSelectedPlanId(null)}
          onPlanUpdated={load}
        />
      )}
    </div>
  )
}
