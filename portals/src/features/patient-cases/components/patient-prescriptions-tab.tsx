import { formatDistanceToNow } from 'date-fns'
import { ChevronRight, Pill } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import {
  ClinicalPrescriptionSheet,
  type PrescriptionStageRow,
} from '../../clinical/components/clinical-prescription-sheet'

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

import { AddStageSheet } from './add-stage-sheet'

interface Props {
  patientId: string
  patientName?: string
}

export function PatientPrescriptionsTab({ patientId, patientName }: Props) {
  const [stages, setStages] = useState<PrescriptionStageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedStage, setSelectedStage] = useState<PrescriptionStageRow | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Edit mode state
  const [editSheetOpen, setEditSheetOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<PrescriptionStageRow[]>(
      `/api/patient-cases/patient/${patientId}/prescription-stages`
    )
    if (res.success && res.data) {
      // Inject patient object into each stage since it's not provided by this endpoint
      const formattedStages = res.data.map((stage) => ({
        ...stage,
        stageType: 'prescription',
        patient: { id: patientId, name: patientName || 'Unknown Patient', patientId: null },
      })) as PrescriptionStageRow[]
      setStages(formattedStages)
    }
    setLoading(false)
  }, [patientId, patientName])

  useEffect(() => {
    load()
  }, [load])

  function openSheet(stage: PrescriptionStageRow) {
    setSelectedStage(stage)
    setSheetOpen(true)
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    )
  }

  if (stages.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
        <Pill className="h-10 w-10 text-muted-foreground/40" />
        <div>
          <p className="font-medium text-muted-foreground">No prescriptions recorded</p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Prescriptions added to patient cases will appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
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
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {stage.caseNumber}
                    </Badge>
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

      <ClinicalPrescriptionSheet
        stage={selectedStage}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        canEdit={true}
        onEdit={() => {
          setSheetOpen(false)
          setEditSheetOpen(true)
        }}
      />

      {selectedStage && editSheetOpen && (
        <AddStageSheet
          open={editSheetOpen}
          onOpenChange={setEditSheetOpen}
          patientId={patientId}
          caseId={selectedStage.caseId}
          editStage={selectedStage as any}
          onSuccess={() => {
            load()
            setEditSheetOpen(false)
          }}
        />
      )}
    </div>
  )
}
