import { format } from 'date-fns'
import { ChevronLeft, ChevronRight as ChevronRightIcon, X } from 'lucide-react'
import { useState } from 'react'
import { Odontogram } from 'react-odontogram'
import { Badge } from '@/shared/components/ui/badge'
import type { LookupSelection } from '@/shared/components/ui/lookup-multiselect'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/components/ui/sheet'
import { formatAmount } from '@/shared/utils/currency'
import type { CaseStage } from './case-detail-sheet'

// ─── Shared image gallery ─────────────────────────────────────────────────────

function ImageGallery({ images }: { images: Array<{ name: string; dataUrl: string }> }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  if (images.length === 0) return null

  const prev = () =>
    setLightboxIdx((i) => (i != null ? (i - 1 + images.length) % images.length : 0))
  const next = () => setLightboxIdx((i) => (i != null ? (i + 1) % images.length : 0))

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') prev()
    else if (e.key === 'ArrowRight') next()
    else if (e.key === 'Escape') setLightboxIdx(null)
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {images.map((img, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: image array has no stable id
          <button
            key={i}
            type="button"
            className="rounded-md border border-border overflow-hidden hover:opacity-80 transition-opacity focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setLightboxIdx(i)}
            aria-label={`View image ${i + 1}`}
          >
            <img src={img.dataUrl} alt={img.name} className="h-20 w-20 object-cover" />
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIdx != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxIdx(null)}
          onKeyDown={handleKeyDown}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focus trap for keyboard nav
          tabIndex={0}
          ref={(el) => el?.focus()}
        >
          {/* Close */}
          <button
            type="button"
            className="absolute top-4 right-4 h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10"
            onClick={(e) => {
              e.stopPropagation()
              setLightboxIdx(null)
            }}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Counter */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm tabular-nums">
            {lightboxIdx + 1} / {images.length}
          </div>

          {/* Prev */}
          {images.length > 1 && (
            <button
              type="button"
              className="absolute left-4 h-10 w-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                prev()
              }}
              aria-label="Previous image"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Image */}
          <img
            src={images[lightboxIdx].dataUrl}
            alt={images[lightboxIdx].name}
            className="max-h-[85vh] max-w-[90vw] rounded-md object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Next */}
          {images.length > 1 && (
            <button
              type="button"
              className="absolute right-4 h-10 w-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                next()
              }}
              aria-label="Next image"
            >
              <ChevronRightIcon className="h-6 w-6" />
            </button>
          )}

          {/* Name caption */}
          {images[lightboxIdx].name && (
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-xs truncate max-w-xs">
              {images[lightboxIdx].name}
            </p>
          )}
        </div>
      )}
    </>
  )
}

const UNIVERSAL_TO_INTERNAL: Record<string, string> = {
  '1': 'teeth-18',
  '2': 'teeth-17',
  '3': 'teeth-16',
  '4': 'teeth-15',
  '5': 'teeth-14',
  '6': 'teeth-13',
  '7': 'teeth-12',
  '8': 'teeth-11',
  '9': 'teeth-21',
  '10': 'teeth-22',
  '11': 'teeth-23',
  '12': 'teeth-24',
  '13': 'teeth-25',
  '14': 'teeth-26',
  '15': 'teeth-27',
  '16': 'teeth-28',
  '17': 'teeth-38',
  '18': 'teeth-37',
  '19': 'teeth-36',
  '20': 'teeth-35',
  '21': 'teeth-34',
  '22': 'teeth-33',
  '23': 'teeth-32',
  '24': 'teeth-31',
  '25': 'teeth-41',
  '26': 'teeth-42',
  '27': 'teeth-43',
  '28': 'teeth-44',
  '29': 'teeth-45',
  '30': 'teeth-46',
  '31': 'teeth-47',
  '32': 'teeth-48',
}

// ─── Stage label map ──────────────────────────────────────────────────────────

export const STAGE_LABEL: Record<string, string> = {
  // v1 legacy
  patient_concern: 'Patient Concern',
  oral_health: 'Oral Health',
  // v2
  presenting_complaint: 'Presenting Complaint',
  history_of_presenting_complaint: 'History of Presenting Complaints',
  past_medical_surgical_history: 'Past Medical & Surgical History',
  drug_history_allergies: 'Drug History & Allergies',
  social_history: 'Social History',
  diagnosis: 'Diagnosis',
  examination: 'Examination',
  treatment_plan: 'Treatment Plan',
  prescription: 'Prescription',
  // §2.5 — merged Review stage; legacy entries kept readable
  review: 'Review',
  dental_review: 'Dental Review',
  ortho_review: 'Ortho Review',
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
        {label}
      </p>
      <p className="text-sm whitespace-pre-line">{value}</p>
    </div>
  )
}

function SelectionList({ label, items }: { label: string; items: LookupSelection[] | undefined }) {
  if (!items || items.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {items.map((i) => (
          <Badge key={i.id} variant="secondary" className="text-xs">
            {i.displayName ?? i.name}
          </Badge>
        ))}
      </div>
    </div>
  )
}

// Legacy `patient_concern` payload format: { chiefComplaint: string }
function PatientConcernDetail({ data }: { data: Record<string, unknown> }) {
  return <Field label="Chief Complaint" value={data.chiefComplaint as string} />
}

// v2 generic items+notes renderer (presenting complaint, history, social, etc.)
function ItemsAndNotesDetail({
  data,
  itemsLabel,
}: {
  data: Record<string, unknown>
  itemsLabel: string
}) {
  return (
    <div className="space-y-3">
      <SelectionList label={itemsLabel} items={data.items as LookupSelection[]} />
      <Field label="Notes" value={data.notes as string} />
    </div>
  )
}

// §2.2 / CC.1 — diagnosis: coded ICD-10 badges (code + title) above the free-text
// lookup + notes. Coded list is additive and may be empty for legacy stages.
function DiagnosisDetail({ data }: { data: Record<string, unknown> }) {
  const codes = (data.icd10Codes as Array<{ code: string; title: string }>) ?? []
  return (
    <div className="space-y-3">
      {codes.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
            ICD-10 codes
          </p>
          <div className="flex flex-wrap gap-1">
            {codes.map((c) => (
              <Badge key={c.code} variant="secondary" className="text-xs">
                <span className="font-mono">{c.code}</span>
                <span className="ml-1">{c.title}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}
      <SelectionList label="Diagnosis" items={data.items as LookupSelection[]} />
      <Field label="Notes" value={data.notes as string} />
    </div>
  )
}

function DrugHistoryAllergiesDetail({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-3">
      <SelectionList label="Drug history" items={data.drugs as LookupSelection[]} />
      <SelectionList label="Allergies" items={data.allergies as LookupSelection[]} />
      <Field label="Notes" value={data.notes as string} />
    </div>
  )
}

// Legacy `oral_health` payload format: per-field { value, detail }
function LegacyOralHealthDetail({ data }: { data: Record<string, unknown> }) {
  const fields: { key: string; label: string }[] = [
    { key: 'Prescriptions', label: 'Prescriptions' },
    { key: 'allergies', label: 'Allergies' },
    { key: 'prevDental', label: 'Previous dental treatments' },
    { key: 'recentDental', label: 'Dental treatments in past 6 months' },
    { key: 'gumBleeding', label: 'Gum bleeding' },
  ]
  return (
    <div className="space-y-3">
      {fields.map(({ key, label }) => {
        const f = data[key] as { value?: string; detail?: string } | undefined
        if (!f) return null
        return (
          <div key={key} className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
              {label}
            </p>
            <p className="text-sm capitalize">{f.value ?? 'No'}</p>
            {f.value === 'yes' && f.detail && (
              <p className="text-xs text-muted-foreground">{f.detail}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OralHealthDetail({ data }: { data: Record<string, unknown> }) {
  // v2 records use the same items+notes shape; legacy records have per-field objects.
  if (Array.isArray((data as any).items)) {
    return <ItemsAndNotesDetail data={data} itemsLabel="Past medical & surgical history" />
  }
  return <LegacyOralHealthDetail data={data} />
}

function ExaminationDetail({ data }: { data: Record<string, unknown> }) {
  if (data.subType === 'chart') {
    const conditions =
      (data.conditions as Array<{ label: string; color: string; teeth: string[] }>) ?? []
    const teethConditions = conditions.map((c) => ({
      label: c.label,
      fillColor: c.color,
      outlineColor: c.color,
      teeth: c.teeth.map((u) => UNIVERSAL_TO_INTERNAL[u]).filter(Boolean),
    }))
    return (
      <div className="space-y-3">
        <div className="pointer-events-none">
          <Odontogram
            notation="Universal"
            layout="square"
            onChange={() => {}}
            teethConditions={teethConditions}
            styles={{ maxWidth: '100%' }}
          />
        </div>
        {conditions.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
              Conditions
            </p>
            {conditions.map((c, ci) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: condition array has no stable id
              <div key={ci} className="flex items-center gap-1.5 text-xs">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: c.color }}
                />
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground font-mono">— {c.teeth.join(', ')}</span>
              </div>
            ))}
          </div>
        )}
        <Field label="Chart notes" value={data.chartNotes as string} />
      </div>
    )
  }

  const isNewFormat =
    data.subType === 'diagnosis' ||
    data.examTypeId != null ||
    data.diagnosisNotes != null ||
    data.images != null

  if (isNewFormat) {
    const images = data.images as Array<{ name: string; dataUrl: string }> | undefined
    return (
      <div className="space-y-3">
        <Field label="Exam type" value={data.examTypeName as string} />
        <Field label="Notes" value={data.diagnosisNotes as string} />
        {images && images.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
              Images
            </p>
            <ImageGallery images={images} />
          </div>
        )}
      </div>
    )
  }

  return <p className="text-sm text-muted-foreground">No examination data recorded.</p>
}

function TreatmentEntryCard({ entry, idx }: { entry: Record<string, unknown>; idx: number }) {
  const name =
    (entry.serviceName as string) || (entry.procedureName as string) || `Treatment ${idx + 1}`
  const cost =
    entry.cost != null
      ? Number(entry.cost)
      : entry.estimatedCost != null
        ? Number(entry.estimatedCost)
        : null
  const disc = entry.discount != null ? Number(entry.discount) : null
  const final = entry.finalCost != null ? Number(entry.finalCost) : null

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5">
      <p className="text-xs font-semibold">{name}</p>
      {cost != null && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>GHS {formatAmount(Number(cost))}</span>
          {disc != null && disc > 0 && (
            <>
              <span>· {disc}% disc</span>
              {final != null && (
                <span className="font-medium text-foreground">
                  → GHS {formatAmount(Number(final))}
                </span>
              )}
            </>
          )}
        </div>
      )}
      {entry.notes != null && (entry.notes as string).trim() !== '' && (
        <Field label="Notes" value={entry.notes as string} />
      )}
    </div>
  )
}

function TreatmentPlanDetail({ data }: { data: Record<string, unknown> }) {
  const stages = data.stages as
    | Array<{ name?: string; entries?: Array<Record<string, unknown>> }>
    | undefined
  const flatEntries = data.entries as Array<Record<string, unknown>> | undefined

  if (stages && stages.length > 0) {
    return (
      <div className="space-y-4">
        {stages.map((stage, si) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: JSON blob stages have no stable id
          <div key={si}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {stage.name ?? `Stage ${si + 1}`}
            </p>
            <div className="space-y-2 pl-3 border-l-2 border-border">
              {(stage.entries ?? []).map((entry, ei) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: JSON blob entries have no stable id
                <TreatmentEntryCard key={ei} entry={entry} idx={ei} />
              ))}
              {(stage.entries ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground italic">No treatments in this stage.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const entries = flatEntries ?? []
  if (entries.length === 0)
    return <p className="text-sm text-muted-foreground">No treatments recorded.</p>
  return (
    <div className="space-y-3">
      {entries.map((entry, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: JSON blob entries have no stable id
        <TreatmentEntryCard key={idx} entry={entry} idx={idx} />
      ))}
    </div>
  )
}

function PrescriptionDetail({ data }: { data: Record<string, unknown> }) {
  const Prescriptions = data.Prescriptions as
    | Array<{
        Prescription?: string
        dosage?: string
        frequency?: string
        duration?: string
        inventoryItemId?: string | null
        quantity?: number
      }>
    | undefined

  if (Prescriptions && Prescriptions.length > 0) {
    return (
      <div className="space-y-4">
        {Prescriptions.map((drug, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: JSON blob Prescriptions have no stable id
          <div key={idx} className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold">{drug.Prescription || `Drug ${idx + 1}`}</p>
              {drug.inventoryItemId ? (
                <Badge variant="outline" className="text-[10px]">
                  Inventory · qty {drug.quantity ?? 1}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  Free text
                </Badge>
              )}
            </div>
            <Field label="Dosage" value={drug.dosage} />
            <Field label="Frequency" value={drug.frequency} />
            <Field label="Duration" value={drug.duration} />
          </div>
        ))}
        {data.notes != null && <Field label="General notes" value={data.notes as string} />}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Field label="Prescription" value={data.Prescription as string} />
      <Field label="Dosage" value={data.dosage as string} />
      <Field label="Frequency" value={data.frequency as string} />
      <Field label="Duration" value={data.duration as string} />
      <Field label="Notes" value={data.notes as string} />
    </div>
  )
}

function OrthoReviewDetail({ data }: { data: Record<string, unknown> }) {
  const images = (data.images as Array<{ name: string; dataUrl: string }>) ?? []
  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
            Photos
          </p>
          <ImageGallery images={images} />
        </div>
      )}
      <SelectionList
        label="Current treatment"
        items={data.currentTreatments as LookupSelection[]}
      />
      <SelectionList label="Next treatment" items={data.nextTreatments as LookupSelection[]} />
      <Field label="Notes" value={data.notes as string} />
    </div>
  )
}

// §2.5 — merged Review stage: dispatch by subType (general | ortho). Falls back
// to the general shape so older/unspecified payloads still render.
function ReviewDetail({ data }: { data: Record<string, unknown> }) {
  if (data.subType === 'ortho') {
    return <OrthoReviewDetail data={data} />
  }
  return <ItemsAndNotesDetail data={data} itemsLabel="Review feedback" />
}

// ─── Public renderer ──────────────────────────────────────────────────────────

export function StageDataView({ stage }: { stage: CaseStage }) {
  return <StageBody stage={stage} />
}

function StageBody({ stage }: { stage: CaseStage }) {
  const { stageType, data } = stage
  switch (stageType) {
    case 'patient_concern':
      return <PatientConcernDetail data={data} />
    case 'presenting_complaint':
      return <ItemsAndNotesDetail data={data} itemsLabel="Presenting complaint" />
    case 'history_of_presenting_complaint':
      return <ItemsAndNotesDetail data={data} itemsLabel="History of presenting complaint" />
    case 'past_medical_surgical_history':
      return <ItemsAndNotesDetail data={data} itemsLabel="Past medical & surgical history" />
    case 'oral_health':
      return <OralHealthDetail data={data} />
    case 'drug_history_allergies':
      return <DrugHistoryAllergiesDetail data={data} />
    case 'social_history':
      return <ItemsAndNotesDetail data={data} itemsLabel="Social history" />
    case 'diagnosis':
      return <DiagnosisDetail data={data} />
    case 'examination':
      return <ExaminationDetail data={data} />
    case 'treatment_plan':
      return <TreatmentPlanDetail data={data} />
    case 'prescription':
      return <PrescriptionDetail data={data} />
    case 'review':
      return <ReviewDetail data={data} />
    case 'dental_review':
      return <ItemsAndNotesDetail data={data} itemsLabel="Review feedback" />
    case 'ortho_review':
      return <OrthoReviewDetail data={data} />
    default:
      return <p className="text-sm text-muted-foreground">No renderer for {stageType}.</p>
  }
}

interface Props {
  stage: CaseStage
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit?: boolean
  onUpdated?: (stage: CaseStage) => void
}

export function StageDetailSheet({ stage, open, onOpenChange }: Props) {
  const label = STAGE_LABEL[stage.stageType] ?? stage.stageType
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:!max-w-[40vw] overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle>{label}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            Recorded {format(new Date(stage.createdAt), 'MMM d, yyyy · h:mm a')}
            {stage.createdBy ? ` by ${stage.createdBy.name}` : ''}
          </p>
        </SheetHeader>
        <div className="pt-4 space-y-4">
          <StageBody stage={stage} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
