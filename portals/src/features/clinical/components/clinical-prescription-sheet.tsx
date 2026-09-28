import { format, isValid, parseISO } from 'date-fns'
import { ExternalLink, Printer } from 'lucide-react'
import { Link } from 'react-router-dom'
import { type Drug, DrugCard } from '@/shared/components/drug-card'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Sheet, SheetContent, SheetHeader } from '@/shared/components/ui/sheet'
import { generatePrescriptionReceipt } from '@/shared/utils/prescription-print'

// ─── Types ────────────────────────────────────────────────────────────────────

type PrescriptionStageDataMulti = {
  kind?: 'multi'
  medications: Drug[]
  notes?: string
}

type PrescriptionStageDataLegacy = {
  kind?: 'legacy'
  medication: string
  dosage?: string
  frequency?: string
  duration?: string
  notes?: string
}

type PrescriptionStageDataBase = {
  notes?: string
}

type PrescriptionStageData =
  | PrescriptionStageDataMulti
  | PrescriptionStageDataLegacy
  | PrescriptionStageDataBase

export type PrescriptionStageRow = {
  id: string
  data: PrescriptionStageData
  createdAt: string
  caseId: string
  caseNumber: string
  patient: { id: string; name: string; patientId: string | null }
  createdByName: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDrugs(data: PrescriptionStageData): Drug[] {
  if ('medications' in data && data.medications && data.medications.length > 0) {
    return data.medications
  }
  if ('medication' in data && data.medication) {
    return [
      {
        medication: data.medication,
        dosage: data.dosage,
        frequency: data.frequency,
        duration: data.duration,
      },
    ]
  }
  return []
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  stage: PrescriptionStageRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit?: () => void
  canEdit?: boolean
}

export function ClinicalPrescriptionSheet({ stage, open, onOpenChange, onEdit, canEdit }: Props) {
  if (!stage) return null

  const drugs = getDrugs(stage.data)

  function handlePrint() {
    if (!stage) return
    generatePrescriptionReceipt({
      patientName: stage.patient?.name ?? 'Unknown Patient',
      prescribedBy: stage.createdByName,
      drugs,
      notes: stage.data.notes,
      clinicName: import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic',
      clinicPhone: import.meta.env.VITE_CLINIC_PHONE,
      clinicAddress: import.meta.env.VITE_CLINIC_ADDRESS,
      generatedAt: new Date().toLocaleString(),
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          {/* Patient + case header */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {stage.patient?.name ?? 'Unknown Patient'}
              </p>
              {stage.patient?.patientId && (
                <Badge variant="outline" className="font-mono text-[10px] h-4 px-1.5">
                  {stage.patient.patientId}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground/70">Prescribed</span> {(() => {
                const d = parseISO(stage.createdAt)
                return isValid(d) ? format(d, 'MMM d, yyyy') : '—'
              })()}
            </span>
            {stage.createdByName && (
              <span>
                <span className="font-medium text-foreground/70">By</span> {stage.createdByName}
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="pt-4 space-y-2">
          {drugs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-8">
              No prescriptions recorded.
            </p>
          ) : (
            drugs.map((drug, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: JSON blob medications have no stable id
              <DrugCard key={i} drug={drug} />
            ))
          )}

          {stage.data.notes && (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
              <p className="text-xs font-medium text-muted-foreground mb-1">General notes</p>
              <p className="text-sm">{stage.data.notes}</p>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-border mt-4 space-y-3">
          <div className="flex gap-2">
            {canEdit && onEdit && (
              <Button variant="secondary" className="flex-1" onClick={onEdit}>
                Edit Details
              </Button>
            )}
            <Button variant="default" className="flex-1" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </div>

          {/* Footer link to case */}
          {stage.patient?.id && (
            <Button variant="outline" size="sm" asChild className="w-full">
              <Link to={`/patients/${stage.patient.id}/cases/${stage.caseId}`}>
                <ExternalLink className="h-3.5 w-3.5 mr-2" />
                View case
              </Link>
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
