import { formatDistanceToNow } from 'date-fns'
import { ChevronRight, Pill } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
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
import { ClinicalPrescriptionSheet, type PrescriptionStageRow } from './clinical-prescription-sheet'

const PAGE_SIZE = 25

type Drug = {
  medication: string
  dosage?: string
  frequency?: string
  duration?: string
}

type PrescriptionData = {
  medications?: Drug[]
  medication?: string
  notes?: string
}

function getDrugs(data: PrescriptionData): Drug[] {
  if (data.medications && data.medications.length > 0) return data.medications
  if (data.medication) return [{ medication: data.medication }]
  return []
}

function drugSummary(data: PrescriptionData): string {
  const drugs = getDrugs(data)
  if (drugs.length === 0) return '—'
  const names = drugs.map((d) => d.medication)
  if (names.length <= 2) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClinicalPrescriptionsTab() {
  const [stages, setStages] = useState<PrescriptionStageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedStage, setSelectedStage] = useState<PrescriptionStageRow | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // §5.1 — reset to page 1 whenever the search term changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed off search, not page
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (debouncedSearch) params.set('search', debouncedSearch)
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    params.set('limit', String(PAGE_SIZE))
    const res = await api.get<PrescriptionStageRow[]>(
      `/api/patient-cases/prescription-stages/all?${params}`
    )
    if (res.success && res.data) setStages(res.data as PrescriptionStageRow[])
    setLoading(false)
  }, [debouncedSearch, page])

  useEffect(() => {
    load()
  }, [load])

  function openSheet(stage: PrescriptionStageRow) {
    setSelectedStage(stage)
    setSheetOpen(true)
  }

  return (
    <div className="p-6 space-y-4">
      {/* Search */}
      <Input
        placeholder="Search by patient name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8 max-w-xs text-sm"
      />

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : stages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Pill className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-medium text-muted-foreground">No prescriptions found</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {search
                ? 'Try adjusting your search.'
                : 'Prescriptions added to cases will appear here.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead className="w-[120px]">Case #</TableHead>
                <TableHead>Prescriptions</TableHead>
                <TableHead className="w-[90px]">Count</TableHead>
                <TableHead className="w-[130px]">Prescribed by</TableHead>
                <TableHead className="w-[140px]">Date</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {stages.map((stage) => {
                const drugs = getDrugs(stage.data as PrescriptionData)
                return (
                  <TableRow
                    key={stage.id}
                    className="cursor-pointer"
                    onClick={() => openSheet(stage)}
                  >
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{stage.patient.name}</p>
                        {stage.patient.patientId && (
                          <p className="text-xs text-muted-foreground font-mono">
                            {stage.patient.patientId}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/patients/${stage.patient.id}?tab=medical`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:opacity-80 transition-opacity"
                      >
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {stage.caseNumber}
                        </Badge>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm max-w-xs truncate text-muted-foreground">
                      {drugSummary(stage.data as PrescriptionData)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {drugs.length}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{stage.createdByName ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span title={new Date(stage.createdAt).toLocaleString()}>
                        {formatDistanceToNow(new Date(stage.createdAt), { addSuffix: true })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* §5.1 — server-side pagination */}
      {!loading && stages.length > 0 && (
        <ClinicalPagination
          page={page}
          pageSize={PAGE_SIZE}
          rowCount={stages.length}
          onPageChange={setPage}
        />
      )}

      {/* Detail sheet */}
      <ClinicalPrescriptionSheet
        stage={selectedStage}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  )
}
