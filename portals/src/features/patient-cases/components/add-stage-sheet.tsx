import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Stethoscope,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Odontogram } from 'react-odontogram'
import { toast } from 'sonner'
import { useClinicalPreferences } from '@/features/clinical/use-clinical-preferences'
import { getItems } from '@/lib/actions/items'
import { isOrthoPatient } from '@/lib/actions/patient-tags'
import { getServices } from '@/lib/actions/services'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { LookupMultiSelect, type LookupSelection } from '@/shared/components/ui/lookup-multiselect'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import {
  type OverridePayload,
  useTreatmentGateOverride,
} from '@/shared/hooks/use-treatment-gate-override'
import { surfaceApiError } from '@/shared/lib/api-error'
import { uploadCaseImage } from '@/shared/lib/upload-blob'
import { formatAmount } from '@/shared/utils/currency'
import type { CaseStage } from './case-detail-sheet'
import { Icd10MultiSelect, type Icd10Selection } from './icd10-multiselect'

// ─── Types ────────────────────────────────────────────────────────────────────

type StageType =
  // legacy v1 — readable but no longer offered in the picker
  | 'patient_concern'
  | 'oral_health'
  // v2
  | 'presenting_complaint'
  | 'history_of_presenting_complaint'
  | 'past_medical_surgical_history'
  | 'drug_history_allergies'
  | 'social_history'
  | 'diagnosis'
  | 'examination'
  | 'treatment_plan'
  | 'prescription'
  | 'review'
  // legacy v1 review stages — readable but no longer offered in the picker
  | 'dental_review'
  | 'ortho_review'

interface ExaminationType {
  id: string
  name: string
  displayName?: string
}
interface InventoryItem {
  id: string
  name: string
  sku: string | null
  stockQuantity: number
  unit: string | null
}
interface DrugFrequency {
  id: string
  name: string
  displayName: string | null
}
interface Service {
  id: string
  name: string
  amount: number
  currency: string
  category?: string
}

type DrugEntry = {
  medication: string
  inventoryItemId: string | null
  dosage: string
  frequency: string
  duration: string
  quantity: number
  notes?: string
}
type TreatmentEntry = {
  serviceId: string | null
  serviceName: string
  cost: number
  discount: number
  finalCost: number
  notes: string
  // legacy v1 fields — preserved when loading existing stage data
  procedureName?: string
  treatmentTypeId?: string
  estimatedCost?: number
}
type TreatmentStage = { name: string; entries: TreatmentEntry[] }
type DentalCondition = { type: string; label: string; color: string; teeth: string[] }
type GalleryImage = { name: string; dataUrl: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const DENTAL_CONDITIONS = [
  { value: 'caries', label: 'Caries / Decay', color: '#ef4444' },
  { value: 'filled', label: 'Filled', color: '#3b82f6' },
  { value: 'crown', label: 'Crown', color: '#f59e0b' },
  { value: 'missing', label: 'Missing', color: '#6b7280' },
  { value: 'root_canal', label: 'Root Canal', color: '#8b5cf6' },
  { value: 'implant', label: 'Implant', color: '#14b8a6' },
  { value: 'bridge', label: 'Bridge', color: '#92400e' },
  { value: 'fracture', label: 'Fracture / Crack', color: '#ec4899' },
  { value: 'calculus', label: 'Calculus / Tartar', color: '#f97316' },
  { value: 'abscess', label: 'Abscess', color: '#7c3aed' },
]

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

type StageOption = { value: StageType; label: string; description: string; orthoOnly?: boolean }

const STAGE_OPTIONS: StageOption[] = [
  {
    value: 'presenting_complaint',
    label: 'Presenting Complaint',
    description: 'What the patient is reporting now',
  },
  {
    value: 'history_of_presenting_complaint',
    label: 'History of Presenting Complaints',
    description: 'Prior occurrences of the same complaint',
  },
  {
    value: 'past_medical_surgical_history',
    label: 'Past Medical & Surgical History',
    description: 'Relevant medical / surgical background',
  },
  {
    value: 'drug_history_allergies',
    label: 'Drug History & Allergies',
    description: 'Prescriptions taken + known allergies',
  },
  {
    value: 'social_history',
    label: 'Social History',
    description: 'Smoking, alcohol, occupation, etc.',
  },
  // §2.3 — examine first, then diagnose
  { value: 'examination', label: 'Examination', description: 'Findings + dental chart' },
  { value: 'diagnosis', label: 'Diagnosis', description: 'Working clinical diagnosis' },
  { value: 'treatment_plan', label: 'Treatment Plan', description: 'Planned treatments' },
  { value: 'prescription', label: 'Prescription', description: 'Prescriptions dispensed' },
  // §2.5 — single Review stage with a General | Ortho card-chooser
  { value: 'review', label: 'Review', description: 'Recall / follow-up — general or ortho' },
]

// ─── Generic "items + notes" form ─────────────────────────────────────────────
// Used by all of the multi-select stages (presenting complaint, history,
// medical/surgical history, social history, diagnosis, dental review).

function ItemsAndNotesForm({
  value,
  onChange,
  lookupType,
  itemsLabel,
  placeholder,
  notesLabel = 'Additional notes',
  notesPlaceholder,
}: {
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  lookupType: string
  itemsLabel: string
  placeholder: string
  notesLabel?: string
  notesPlaceholder?: string
}) {
  const items = (value.items as LookupSelection[]) ?? []
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">{itemsLabel}</Label>
        <LookupMultiSelect
          type={lookupType}
          value={items}
          onChange={(next) => onChange({ ...value, items: next })}
          placeholder={placeholder}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="items-notes" className="text-xs">
          {notesLabel}
        </Label>
        <Textarea
          id="items-notes"
          rows={3}
          placeholder={notesPlaceholder}
          value={(value.notes as string) ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </div>
    </div>
  )
}

// ─── Drug history + allergies form ────────────────────────────────────────────

function DrugHistoryAllergiesForm({
  value,
  onChange,
}: {
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
}) {
  const drugs = (value.drugs as LookupSelection[]) ?? []
  const allergies = (value.allergies as LookupSelection[]) ?? []
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Drug history</Label>
        <LookupMultiSelect
          type="drug-history-items"
          value={drugs}
          onChange={(next) => onChange({ ...value, drugs: next })}
          placeholder="Select Prescriptions…"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Allergies</Label>
        <LookupMultiSelect
          type="allergies"
          value={allergies}
          onChange={(next) => onChange({ ...value, allergies: next })}
          placeholder="Select allergies…"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Additional notes</Label>
        <Textarea
          rows={3}
          value={(value.notes as string) ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </div>
    </div>
  )
}

// ─── Diagnosis form — coded ICD-10 + free-text notes ──────────────────────────
// The free-text diagnosis lookup was removed — ICD-10 coding is the diagnosis
// source now; the notes field carries any differential / working detail.

function DiagnosisForm({
  value,
  onChange,
}: {
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
}) {
  const icd10Codes = (value.icd10Codes as Icd10Selection[]) ?? []
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">ICD-10 codes</Label>
        <Icd10MultiSelect
          value={icd10Codes}
          onChange={(next) => onChange({ ...value, icd10Codes: next })}
          placeholder="Search ICD-10 codes…"
        />
        <p className="text-[11px] text-muted-foreground">
          WHO ICD-10 coding — search by code or title.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="diagnosis-notes" className="text-xs">
          Additional notes
        </Label>
        <Textarea
          id="diagnosis-notes"
          rows={3}
          placeholder="Differential or working diagnosis…"
          value={(value.notes as string) ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </div>
    </div>
  )
}

// ─── Dental chart sub-form (unchanged from v1) ────────────────────────────────

function ChartSection({
  value,
  onChange,
}: {
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
}) {
  const conditions = (value.conditions as DentalCondition[]) ?? []
  const [selectedTeeth, setSelectedTeeth] = useState<string[]>([])
  const [pendingCondType, setPendingCondType] = useState('')
  const [chartKey, setChartKey] = useState(0)

  function markCondition() {
    if (!pendingCondType || selectedTeeth.length === 0) return
    const def = DENTAL_CONDITIONS.find((c) => c.value === pendingCondType)
    if (!def) return
    onChange({
      ...value,
      conditions: [
        ...conditions,
        { type: pendingCondType, label: def.label, color: def.color, teeth: [...selectedTeeth] },
      ],
    })
    setPendingCondType('')
    setSelectedTeeth([])
    setChartKey((k) => k + 1)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Select affected teeth</Label>
        <Odontogram
          key={chartKey}
          notation="Universal"
          layout="square"
          onChange={(teeth) => setSelectedTeeth(teeth.map((t) => t.notations.universal))}
          teethConditions={conditions.map((cond) => ({
            label: cond.label,
            fillColor: cond.color,
            outlineColor: cond.color,
            teeth: cond.teeth.map((u) => UNIVERSAL_TO_INTERNAL[u]).filter(Boolean),
          }))}
          styles={{ maxWidth: '100%' }}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Tooth(s) selected</Label>
        <div className="rounded-md bg-muted/30 border border-border px-2.5 py-2 min-h-[36px]">
          {selectedTeeth.length > 0 ? (
            <p className="text-xs font-mono leading-relaxed break-all">
              {selectedTeeth.join(', ')}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground italic">None selected</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">Select condition</Label>
          <Select value={pendingCondType} onValueChange={setPendingCondType}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select condition…" />
            </SelectTrigger>
            <SelectContent>
              {DENTAL_CONDITIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0 inline-block"
                      style={{ background: c.color }}
                    />
                    <span>{c.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          variant="outline"
          type="button"
          className="h-8"
          disabled={!pendingCondType || selectedTeeth.length === 0}
          onClick={markCondition}
        >
          Mark
        </Button>
      </div>
      {conditions.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs">Marked conditions</Label>
          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
            {conditions.map((cond, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: condition array has no stable id
              <div
                key={i}
                className="flex items-start gap-1.5 rounded-md border border-border px-2 py-1.5"
              >
                <span
                  className="mt-0.5 h-2 w-2 rounded-full shrink-0"
                  style={{ background: cond.color }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{cond.label}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">
                    {cond.teeth.join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-[10px] text-destructive hover:underline shrink-0"
                  onClick={() =>
                    onChange({ ...value, conditions: conditions.filter((_, j) => j !== i) })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1.5 pb-6">
        <Label className="text-xs">Chart notes</Label>
        <Textarea
          rows={3}
          value={(value.chartNotes as string) ?? ''}
          onChange={(e) => onChange({ ...value, chartNotes: e.target.value })}
          className="text-sm"
          placeholder="Additional chart findings…"
        />
      </div>
    </div>
  )
}

// ─── Examination form — buttons + breadcrumb instead of tabs ─────────────────

function ExaminationForm({
  diagnosisValue,
  onDiagnosisChange,
  chartValue,
  onChartChange,
  activeTab,
  onTabChange,
  examTypes,
  patientId,
}: {
  diagnosisValue: Record<string, unknown>
  onDiagnosisChange: (v: Record<string, unknown>) => void
  chartValue: Record<string, unknown>
  onChartChange: (v: Record<string, unknown>) => void
  activeTab: 'diagnosis' | 'chart' | null
  onTabChange: (t: 'diagnosis' | 'chart' | null) => void
  examTypes: ExaminationType[]
  patientId: string
}) {
  const images = (diagnosisValue.images as Array<GalleryImage>) ?? []
  const [uploading, setUploading] = useState(false)

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setUploading(true)
    try {
      const uploaded: GalleryImage[] = []
      for (const file of files) {
        try {
          const url = await uploadCaseImage(file, { patientId })
          // GalleryImage's `dataUrl` field is reused to hold the persisted URL
          // so all existing image renderers (which read `dataUrl`) keep working.
          uploaded.push({ name: file.name, dataUrl: url })
        } catch (err: any) {
          toast.error(`Failed to upload ${file.name}: ${err?.message || 'unknown error'}`)
        }
      }
      if (uploaded.length > 0) {
        onDiagnosisChange({
          ...diagnosisValue,
          images: [...images, ...uploaded],
        })
      }
    } finally {
      setUploading(false)
    }
  }

  // No sub-type selected yet — show two selection buttons
  if (!activeTab) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Select an examination type</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className="flex flex-col items-center gap-3 rounded-xl border-2 border-border bg-card p-6 text-center hover:border-primary hover:bg-primary/5 transition-colors"
            onClick={() => onTabChange('diagnosis')}
          >
            <Stethoscope className="h-7 w-7 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">Gen. Findings</p>
              <p className="text-xs text-muted-foreground mt-0.5">Exam type, images, notes</p>
            </div>
          </button>
          <button
            type="button"
            className="flex flex-col items-center gap-3 rounded-xl border-2 border-border bg-card p-6 text-center hover:border-primary hover:bg-primary/5 transition-colors"
            onClick={() => onTabChange('chart')}
          >
            <ClipboardList className="h-7 w-7 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">Dental Chart</p>
              <p className="text-xs text-muted-foreground mt-0.5">Odontogram + conditions</p>
            </div>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb — clicking "Examination" goes back to sub-type selection */}
      <nav className="flex items-center gap-1.5 text-xs">
        <button
          type="button"
          className="text-primary hover:underline font-medium"
          onClick={() => onTabChange(null)}
        >
          Examination
        </button>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-foreground font-medium">
          {activeTab === 'diagnosis' ? 'Gen. Findings' : 'Dental Chart'}
        </span>
      </nav>

      {/* Sub-form content */}
      {activeTab === 'diagnosis' && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Examination type</Label>
            <Select
              value={(diagnosisValue.examTypeId as string) ?? ''}
              onValueChange={(v) => {
                const type = examTypes.find((t) => t.id === v)
                onDiagnosisChange({
                  ...diagnosisValue,
                  examTypeId: v,
                  examTypeName: type?.displayName ?? type?.name ?? v,
                })
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                {examTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.displayName ?? t.name}
                  </SelectItem>
                ))}
                {examTypes.length === 0 && (
                  <SelectItem value="_none" disabled>
                    No types configured
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Images (X-rays, photos)</Label>
            <label className="flex items-center gap-2 cursor-pointer rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors">
              <span>{uploading ? 'Uploading…' : '+ Attach image'}</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFiles}
                disabled={uploading}
              />
            </label>
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {images.map((img, idx) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: image array has no stable id
                  <div key={idx} className="relative group">
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="h-16 w-16 rounded-md object-cover border border-border"
                    />
                    <button
                      type="button"
                      className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() =>
                        onDiagnosisChange({
                          ...diagnosisValue,
                          images: images.filter((_, i) => i !== idx),
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              rows={2}
              value={(diagnosisValue.diagnosisNotes as string) ?? ''}
              onChange={(e) =>
                onDiagnosisChange({ ...diagnosisValue, diagnosisNotes: e.target.value })
              }
              className="text-sm"
              placeholder="Findings…"
            />
          </div>
        </div>
      )}

      {activeTab === 'chart' && <ChartSection value={chartValue} onChange={onChartChange} />}
    </div>
  )
}

// ─── Service picker combobox ──────────────────────────────────────────────────

function ServicePicker({
  services,
  onSelect,
}: {
  services: Service[]
  onSelect: (s: Service) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = !query.trim()
    ? services.slice(0, 50)
    : services.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())).slice(0, 50)

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search services to add…"
        className="h-8 text-sm"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-md border border-border bg-popover shadow-md">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(s)
                setQuery('')
                setOpen(false)
              }}
            >
              <span className="font-medium truncate">{s.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                GHS {formatAmount(Number(s.amount))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Treatment plan form — service-based inline entries ───────────────────────

function TreatmentPlanForm({
  value,
  onChange,
  services,
}: {
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  services: Service[]
}) {
  const stages = (value.stages as TreatmentStage[]) ?? [{ name: 'Stage 1', entries: [] }]

  function updateStages(next: TreatmentStage[]) {
    onChange({ ...value, stages: next })
  }
  function addStage() {
    updateStages([...stages, { name: `Stage ${stages.length + 1}`, entries: [] }])
  }
  function removeStage(si: number) {
    updateStages(stages.filter((_, i) => i !== si))
  }
  function updateStageName(si: number, name: string) {
    const next = [...stages]
    next[si] = { ...next[si], name }
    updateStages(next)
  }
  function addServiceEntry(si: number, svc: Service) {
    const next = [...stages]
    next[si] = {
      ...next[si],
      entries: [
        ...next[si].entries,
        {
          serviceId: svc.id,
          serviceName: svc.name,
          cost: Number(svc.amount),
          discount: 0,
          finalCost: Number(svc.amount),
          notes: '',
        },
      ],
    }
    updateStages(next)
  }
  function removeEntry(si: number, ei: number) {
    const next = [...stages]
    next[si] = { ...next[si], entries: next[si].entries.filter((_, i) => i !== ei) }
    updateStages(next)
  }
  function updateEntry(si: number, ei: number, patch: Partial<TreatmentEntry>) {
    const next = [...stages]
    const entries = [...next[si].entries]
    const current = { ...entries[ei], ...patch }
    // Recalculate finalCost whenever cost or discount changes. `cost`,
    // `discount` and `finalCost` are all integer CENTS — discount is a fixed
    // amount, not a percentage.
    if ('cost' in patch || 'discount' in patch) {
      const cost = Number(current.cost ?? 0)
      const disc = Math.max(0, Number(current.discount ?? 0))
      current.finalCost = Math.max(0, cost - disc)
    }
    entries[ei] = current
    next[si] = { ...next[si], entries }
    updateStages(next)
  }

  return (
    <div className="space-y-4">
      {stages.map((stage, si) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: JSON blob stages have no stable id
        <div key={si} className="rounded-lg border border-border">
          {/* Stage header */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30">
            <Input
              value={stage.name}
              onChange={(e) => updateStageName(si, e.target.value)}
              className="h-7 text-sm font-semibold border-0 bg-transparent p-0 focus-visible:ring-0 flex-1"
            />
            <span className="text-xs text-muted-foreground shrink-0">
              {stage.entries.length} service{stage.entries.length !== 1 ? 's' : ''}
            </span>
            {stages.length > 1 && (
              <button
                type="button"
                className="text-xs text-destructive hover:underline shrink-0"
                onClick={() => removeStage(si)}
              >
                Remove
              </button>
            )}
          </div>

          <div className="p-3 space-y-2">
            {/* Inline service rows */}
            {stage.entries.length > 0 && (
              <div className="space-y-2">
                {/* Column headers */}
                <div className="grid grid-cols-[1fr_80px_60px_80px_1fr_28px] gap-1.5 px-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Service
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Cost (GHS)
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Disc (GHS)
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Final
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Notes
                  </p>
                  <span />
                </div>
                {stage.entries.map((entry, ei) => {
                  const cost = Number(entry.cost ?? entry.estimatedCost ?? 0)
                  const disc = Number(entry.discount ?? 0)
                  const final =
                    entry.finalCost != null ? Number(entry.finalCost) : Math.max(0, cost - disc)
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: JSON blob entries have no stable id
                    <div
                      key={ei}
                      className="grid grid-cols-[1fr_80px_60px_80px_1fr_28px] gap-1.5 items-center"
                    >
                      <p className="text-sm font-medium truncate px-1">
                        {entry.serviceName || entry.procedureName || `Service ${ei + 1}`}
                      </p>
                      {/* `cost` and `discount` are carried in CENTS (seeded from
                          the catalog's `svc.amount`); these inputs show cedis. */}
                      <Input
                        type="number"
                        min={0}
                        value={cost / 100}
                        onChange={(e) =>
                          updateEntry(si, ei, { cost: Math.round(Number(e.target.value) * 100) })
                        }
                        className="h-7 text-xs"
                      />
                      <Input
                        type="number"
                        min={0}
                        value={disc / 100}
                        onChange={(e) =>
                          updateEntry(si, ei, {
                            discount: Math.round(Number(e.target.value) * 100),
                          })
                        }
                        className="h-7 text-xs"
                        placeholder="0"
                      />
                      <span className="text-xs font-medium tabular-nums text-foreground px-1">
                        {formatAmount(Number(final))}
                      </span>
                      <Input
                        value={entry.notes}
                        onChange={(e) => updateEntry(si, ei, { notes: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="Notes…"
                      />
                      <button
                        type="button"
                        className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        onClick={() => removeEntry(si, ei)}
                        aria-label="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Service picker combobox */}
            <ServicePicker services={services} onSelect={(svc) => addServiceEntry(si, svc)} />
          </div>
        </div>
      ))}
      <Button variant="ghost" size="sm" type="button" onClick={addStage}>
        + Add stage
      </Button>
    </div>
  )
}

// ─── Prescription form — v2 with inventory lookup ─────────────────────────────

function PrescriptionPicker({
  drug,
  inventory,
  onChange,
}: {
  drug: DrugEntry
  inventory: InventoryItem[]
  onChange: (patch: Partial<DrugEntry>) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(drug.medication ?? '')
  const filtered = !query.trim()
    ? inventory.slice(0, 50)
    : inventory
        .filter(
          (i) =>
            i.name.toLowerCase().includes(query.toLowerCase()) ||
            (i.sku ?? '').toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 50)
  const selectedInventory = inventory.find((i) => i.id === drug.inventoryItemId)
  const outOfStock = selectedInventory != null && selectedInventory.stockQuantity <= 0

  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // Typing manually clears the inventory link so we don't double-deduct.
            if (drug.inventoryItemId) {
              onChange({ medication: e.target.value, inventoryItemId: null })
            } else {
              onChange({ medication: e.target.value })
            }
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search Prescriptions or type a new drug name"
          className="h-8 text-sm"
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-md border border-border bg-popover shadow-md">
            {filtered.map((item) => {
              const oos = item.stockQuantity <= 0
              return (
                <button
                  type="button"
                  key={item.id}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({
                      medication: item.name,
                      inventoryItemId: item.id,
                    })
                    setQuery(item.name)
                    setOpen(false)
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.name}</p>
                    {item.sku && (
                      <p className="truncate text-[10px] text-muted-foreground">SKU: {item.sku}</p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      oos
                        ? 'border-destructive/30 text-destructive'
                        : 'border-emerald-200 text-emerald-700'
                    )}
                  >
                    {oos ? 'Out of stock' : `${item.stockQuantity} in stock`}
                  </Badge>
                </button>
              )
            })}
          </div>
        )}
      </div>
      {drug.inventoryItemId && outOfStock && (
        <p className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertTriangle className="h-3 w-3" />
          This item is currently out of stock.
        </p>
      )}
      {!drug.inventoryItemId && drug.medication?.trim() && (
        <p className="text-[11px] text-muted-foreground">
          Not linked to inventory — free-text drug.
        </p>
      )}
    </div>
  )
}

// ─── Dosage + frequency combined inputs ───────────────────────────────────────

// Default units — override via /api/lookups/dosage-units when available
const DEFAULT_DOSAGE_UNITS = ['mg', 'ml', 'g', 'mcg', 'tabs', 'caps', 'drops', 'units', 'IU']
// Default frequency periods — override via /api/lookups/drug-frequencies when available
const DEFAULT_FREQ_PERIODS = [
  'daily',
  'twice daily',
  'three times daily',
  'four times daily',
  'weekly',
  'every 4 hrs',
  'every 6 hrs',
  'every 8 hrs',
  'at bedtime',
  'as needed',
  'monthly',
]

function parseDosage(dosage: string): { amount: string; unit: string } {
  const match = dosage.trim().match(/^(\d*\.?\d+)\s*(.*)$/)
  if (match) return { amount: match[1], unit: match[2].trim() }
  return { amount: '', unit: dosage }
}

function DosageInput({
  value,
  onChange,
  dosageUnits,
}: {
  value: string
  onChange: (combined: string) => void
  dosageUnits: string[]
}) {
  const parsed = parseDosage(value)
  const units = dosageUnits.length > 0 ? dosageUnits : DEFAULT_DOSAGE_UNITS
  return (
    <div className="flex gap-1">
      <Input
        type="number"
        min={0}
        value={parsed.amount}
        onChange={(e) => {
          const amt = e.target.value
          // Guard: only emit combined string when amount is non-empty to avoid
          // storing a bare unit string (e.g. "mg") when the field is cleared.
          onChange(amt ? amt + (parsed.unit || units[0] || '') : '')
        }}
        className="h-8 text-sm w-16 shrink-0"
        placeholder="0"
      />
      <Select
        value={parsed.unit || units[0] || ''}
        onValueChange={(u) => onChange((parsed.amount || '') + u)}
      >
        <SelectTrigger className="h-8 text-sm flex-1 min-w-0">
          <SelectValue placeholder="unit" />
        </SelectTrigger>
        <SelectContent>
          {units.map((u) => (
            <SelectItem key={u} value={u}>
              {u}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

const ADD_NEW_SENTINEL = '__add_new__'

function FrequencyInput({
  value,
  onChange,
  freqPeriods,
}: {
  value: string
  onChange: (combined: string) => void
  freqPeriods: string[]
}) {
  const basePeriods = freqPeriods.length > 0 ? freqPeriods : DEFAULT_FREQ_PERIODS
  const [extraPeriods, setExtraPeriods] = useState<string[]>([])
  const [addingNew, setAddingNew] = useState(false)
  const [newPeriod, setNewPeriod] = useState('')
  const periods = [...basePeriods, ...extraPeriods]

  function confirmNew() {
    const trimmed = newPeriod.trim()
    if (trimmed && !periods.includes(trimmed)) {
      setExtraPeriods((prev) => [...prev, trimmed])
    }
    if (trimmed) onChange(trimmed)
    setAddingNew(false)
    setNewPeriod('')
  }

  if (addingNew) {
    return (
      <div className="flex gap-1">
        <Input
          autoFocus
          value={newPeriod}
          onChange={(e) => setNewPeriod(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              confirmNew()
            }
            if (e.key === 'Escape') {
              setAddingNew(false)
              setNewPeriod('')
            }
          }}
          onBlur={confirmNew}
          className="h-8 text-sm flex-1 min-w-0"
          placeholder="e.g. every 3 days"
        />
      </div>
    )
  }

  return (
    <Select
      value={value || periods[0] || ''}
      onValueChange={(p) => {
        if (p === ADD_NEW_SENTINEL) {
          setAddingNew(true)
          return
        }
        onChange(p)
      }}
    >
      <SelectTrigger className="h-8 text-sm w-full min-w-0">
        <SelectValue placeholder="Select period" />
      </SelectTrigger>
      <SelectContent>
        {periods.map((p) => (
          <SelectItem key={p} value={p}>
            {p}
          </SelectItem>
        ))}
        <SelectItem value={ADD_NEW_SENTINEL} className="text-primary font-medium">
          + Add period…
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

function PrescriptionForm({
  value,
  onChange,
  inventory,
  dosageUnits,
  freqPeriods,
}: {
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  inventory: InventoryItem[]
  dosageUnits: string[]
  freqPeriods: string[]
}) {
  // A new drug row starts with the clinic's default course length
  // (Settings → Clinical → Charting Preferences, settings-domain-audit S5-B).
  const { charting } = useClinicalPreferences()
  const defaultDuration = String(charting.defaultPrescriptionDays)
  let medications: DrugEntry[] = ((value.medications || value.Prescriptions) as DrugEntry[]) || []
  if (!medications || medications.length === 0) {
    if (value.medication || value.Prescription) {
      medications = [
        {
          medication: ((value.medication || value.Prescription) as string) || '',
          inventoryItemId: null,
          dosage: (value.dosage as string) || '',
          frequency: (value.frequency as string) || '',
          duration: (value.duration as string) || '',
          quantity: 1,
          notes: (value.notes as string) || '',
        },
      ]
    } else {
      medications = [
        {
          medication: '',
          inventoryItemId: null,
          dosage: '',
          frequency: '',
          duration: defaultDuration,
          quantity: 1,
        },
      ]
    }
  }
  const [openDrugs, setOpenDrugs] = useState<Record<number, boolean>>({ 0: true })

  function updateDrug(idx: number, patch: Partial<DrugEntry>) {
    const next = [...medications]
    next[idx] = { ...next[idx], ...patch }
    onChange({ ...value, medications: next })
  }
  function addDrug() {
    const newIdx = medications.length
    onChange({
      ...value,
      medications: [
        ...medications,
        {
          medication: '',
          inventoryItemId: null,
          dosage: '',
          frequency: '',
          duration: defaultDuration,
          quantity: 1,
        },
      ],
    })
    setOpenDrugs((prev) => ({ ...prev, [newIdx]: true }))
  }
  function removeDrug(idx: number) {
    onChange({ ...value, medications: medications.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-3">
      {medications.map((drug, idx) => {
        const isOpen = openDrugs[idx] !== false
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: Prescription array has no stable id
          <div key={idx} className="rounded-lg border border-border">
            <div
              className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none hover:bg-muted/20"
              onClick={() => setOpenDrugs((prev) => ({ ...prev, [idx]: !isOpen }))}
            >
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200',
                  !isOpen && '-rotate-90'
                )}
              />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold">
                  {drug.medication || `Drug ${idx + 1}`}
                </span>
                {!isOpen && (drug.dosage || drug.frequency) && (
                  <span className="text-xs text-muted-foreground ml-2">
                    {[drug.dosage, drug.frequency].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              {medications.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-destructive hover:underline shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeDrug(idx)
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            {isOpen && (
              <div className="px-3 pb-3 pt-2 border-t border-border/40 space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Prescription</Label>
                  <PrescriptionPicker
                    drug={drug}
                    inventory={inventory}
                    onChange={(patch) => updateDrug(idx, patch)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Dosage</Label>
                    <DosageInput
                      value={drug.dosage}
                      onChange={(combined) => updateDrug(idx, { dosage: combined })}
                      dosageUnits={dosageUnits}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Frequency</Label>
                    <FrequencyInput
                      value={drug.frequency}
                      onChange={(combined) => updateDrug(idx, { frequency: combined })}
                      freqPeriods={freqPeriods}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Duration (days)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={drug.duration}
                      onChange={(e) => updateDrug(idx, { duration: e.target.value })}
                      className="h-8 text-sm"
                      placeholder="e.g. 5"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Quantity</Label>
                    <Input
                      type="number"
                      min={1}
                      value={drug.quantity}
                      onChange={(e) =>
                        updateDrug(idx, { quantity: Math.max(1, Number(e.target.value)) })
                      }
                      className="h-8 text-sm"
                      disabled={!drug.inventoryItemId}
                      title={
                        drug.inventoryItemId
                          ? 'Amount deducted from inventory'
                          : 'Link to inventory to track quantity'
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-border/40 mt-3">
                  <Label className="text-xs text-muted-foreground">
                    Notes for prescriber / Instructions (Optional)
                  </Label>
                  <Textarea
                    rows={2}
                    value={drug.notes ?? ''}
                    onChange={(e) => updateDrug(idx, { notes: e.target.value })}
                    className="text-sm bg-background"
                    placeholder="Extra information about this specific drug..."
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}

      <Button variant="outline" size="sm" type="button" onClick={addDrug} className="w-full">
        + Add Prescription
      </Button>

      <div className="space-y-1.5">
        <Label className="text-xs">General notes</Label>
        <Textarea
          rows={2}
          value={(value.notes as string) ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          className="text-sm"
          placeholder="Additional instructions…"
        />
      </div>
    </div>
  )
}

// ─── Ortho Review form ────────────────────────────────────────────────────────

function OrthoReviewForm({
  value,
  onChange,
  patientId,
}: {
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  patientId: string
}) {
  const images = (value.images as GalleryImage[]) ?? []
  const currentTreatments = (value.currentTreatments as LookupSelection[]) ?? []
  const nextTreatments = (value.nextTreatments as LookupSelection[]) ?? []
  const [uploading, setUploading] = useState(false)

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setUploading(true)
    try {
      const uploaded: GalleryImage[] = []
      for (const file of files) {
        try {
          const url = await uploadCaseImage(file, { patientId })
          uploaded.push({ name: file.name, dataUrl: url })
        } catch (err: any) {
          toast.error(`Failed to upload ${file.name}: ${err?.message || 'unknown error'}`)
        }
      }
      if (uploaded.length > 0) {
        onChange({ ...value, images: [...images, ...uploaded] })
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Photos (gallery)</Label>
        <label className="flex items-center gap-2 cursor-pointer rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors">
          <span>{uploading ? 'Uploading…' : '+ Attach images'}</span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFiles}
            disabled={uploading}
          />
        </label>
        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            {images.map((img, idx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: image array has no stable id
              <div key={idx} className="relative group aspect-square">
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="h-full w-full rounded-md object-cover border border-border"
                />
                <button
                  type="button"
                  className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onChange({ ...value, images: images.filter((_, i) => i !== idx) })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Current treatment</Label>
        <LookupMultiSelect
          type="ortho-treatments"
          value={currentTreatments}
          onChange={(v) => onChange({ ...value, currentTreatments: v })}
          placeholder="Select current treatment(s)…"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Next treatment</Label>
        <LookupMultiSelect
          type="ortho-treatments"
          value={nextTreatments}
          onChange={(v) => onChange({ ...value, nextTreatments: v })}
          placeholder="Select planned next treatment(s)…"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Notes</Label>
        <Textarea
          rows={3}
          value={(value.notes as string) ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          placeholder="Progress notes, observations…"
        />
      </div>
    </div>
  )
}

// ─── Review form — §5.2 two-panel: visit note + treatment plan stage board ──────

const STAGE_STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

function ReviewStageForm({
  value,
  onChange,
  caseId,
  patientId,
  isOrtho,
  stageStatusChanges,
  onStageStatusChange,
}: {
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  caseId: string
  patientId: string
  /** Ortho patients get a General | Ortho chooser; everyone else sees General. */
  isOrtho: boolean
  stageStatusChanges: Record<string, string>
  onStageStatusChange: (changes: Record<string, string>) => void
}) {
  // `subType` is what the read side dispatches on (stage-detail-sheet's
  // ReviewDetail). It was never written before, so an ortho review could not be
  // recorded at all. Defaults to 'general', including for ortho patients — a
  // routine visit is still a general review.
  const subType = (value.subType as string) ?? 'general'

  const caseQuery = useApiQuery(queryKeys.patientCases.detail(caseId), () =>
    api.get<{ stages: CaseStage[] }>(`/api/patient-cases/${caseId}`)
  )
  const treatmentStages =
    caseQuery.data?.stages?.filter((s) => s.stageType === 'treatment_plan') ?? []

  return (
    <div className="space-y-6">
      {/* ── Review type — ortho patients only ─────────────────────────────────── */}
      {isOrtho && (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { key: 'general', label: 'General', hint: 'Recall / routine follow-up' },
              { key: 'ortho', label: 'Ortho', hint: 'Photos + treatment progress' },
            ] as const
          ).map((opt) => {
            const selected = subType === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                // Switching type keeps `value` intact rather than resetting it:
                // a mis-click must not discard what the clinician already typed.
                onClick={() => onChange({ ...value, subType: opt.key })}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left transition-colors',
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-muted/40'
                )}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-[11px] text-muted-foreground">{opt.hint}</div>
              </button>
            )
          })}
        </div>
      )}

      {subType === 'ortho' && (
        <OrthoReviewForm value={value} onChange={onChange} patientId={patientId} />
      )}

      {/* ── Panel 1 — Visit Note ───────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Visit Note
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Complaint / reason for visit</Label>
          <Textarea
            rows={2}
            placeholder="What brought the patient in today…"
            value={(value.complaint as string) ?? ''}
            onChange={(e) => onChange({ ...value, complaint: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Findings / observations</Label>
          <Textarea
            rows={3}
            placeholder="Examination findings, progress…"
            value={(value.findings as string) ?? ''}
            onChange={(e) => onChange({ ...value, findings: e.target.value })}
          />
        </div>
      </div>

      {/* ── Panel 2 — Treatment Plan Stage Board ──────────────────────────────── */}
      {treatmentStages.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Treatment Plan
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            {treatmentStages.map((stage) => {
              const stageData = stage.data as Record<string, unknown>
              const stagesArr = stageData.stages as Array<{ entries?: unknown[] }> | undefined
              const allEntries = stagesArr
                ? stagesArr.flatMap((s) => s.entries ?? [])
                : ((stageData.entries as unknown[]) ?? [])
              const label =
                allEntries.length > 0
                  ? (allEntries as Array<Record<string, unknown>>)
                      .map((e) => (e.procedureName ?? e.serviceName ?? 'Treatment') as string)
                      .join(', ')
                  : 'Treatment plan'
              const currentStatus = stageStatusChanges[stage.id] ?? stage.status ?? 'planned'

              return (
                <div
                  key={stage.id}
                  className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{label}</p>
                  </div>
                  <Select
                    value={currentStatus}
                    onValueChange={(v) =>
                      onStageStatusChange({ ...stageStatusChanges, [stage.id]: v })
                    }
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGE_STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Visit date field — groups this stage under a clinical visit ──────────────

function VisitDateField({
  value,
  onChange,
  max,
}: {
  value: string
  onChange: (v: string) => void
  max: string
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5">
      <Label htmlFor="stage-visit-date" className="text-xs">
        Visit date
      </Label>
      <Input
        id="stage-visit-date"
        type="date"
        value={value}
        max={max}
        onChange={(e) => onChange(e.target.value || max)}
        className="h-9"
      />
      <p className="text-[11px] text-muted-foreground">
        Stages recorded for the same day are grouped together as one visit.
      </p>
    </div>
  )
}

// ─── Main sheet ───────────────────────────────────────────────────────────────

interface Props {
  caseId: string
  patientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  editStage?: CaseStage
  planItems?: { id: string; procedureName: string; status: string }[]
  /** Optional precomputed ortho flag — saves a fetch when the caller has it. */
  isOrtho?: boolean
  onSuccess: (stage: CaseStage) => void
}

export function AddStageSheet({
  caseId,
  patientId,
  open,
  onOpenChange,
  editStage,
  planItems,
  isOrtho: isOrthoProp,
  onSuccess,
}: Props) {
  const [stageType, setStageType] = useState<StageType | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [chartData, setChartData] = useState<Record<string, unknown>>({})
  const [examTab, setExamTab] = useState<'diagnosis' | 'chart' | null>(null)
  const [stageStatusChanges, setStageStatusChanges] = useState<Record<string, string>>({})
  const dosageUnits = DEFAULT_DOSAGE_UNITS
  const [planItemId, setPlanItemId] = useState<string>('')
  const todayStr = new Date().toISOString().slice(0, 10)
  const [visitDate, setVisitDate] = useState<string>(todayStr)
  const { isSubmitting, submit } = useSubmitGuard()
  const { promptOverride, overrideDialog } = useTreatmentGateOverride()

  // Dosage units aren't an admin-configured lookup — DEFAULT_DOSAGE_UNITS above
  // is authoritative. (There was a fetch to /api/lookups/dosage-units here, but
  // no such lookup type exists on the backend, so it always 400'd.)
  const examTypesQuery = useApiQuery<ExaminationType[]>(
    queryKeys.settings.lookup('examination-types'),
    () => api.get<ExaminationType[]>('/api/lookups/examination-types'),
    { enabled: open }
  )
  const examTypes = examTypesQuery.data ?? []

  // Only items tagged as Prescription populate the prescription picker.
  const prescriptionItemsQuery = useApiQuery<InventoryItem[]>(
    ['items', 'list', { Prescription: true }] as const,
    () => getItems({ Prescription: true }),
    { enabled: open }
  )
  const inventory = prescriptionItemsQuery.data ?? []

  const frequenciesQuery = useApiQuery<DrugFrequency[]>(
    queryKeys.settings.lookup('drug-frequencies'),
    () => api.get<DrugFrequency[]>('/api/lookups/drug-frequencies'),
    { enabled: open }
  )
  const frequencies = frequenciesQuery.data ?? []

  // activeOnly = isActive AND approved. `status: 'active'` filtered only the
  // approval column, so deactivated services reached this picker.
  const servicesQuery = useApiQuery<Service[]>(
    queryKeys.services.list({ activeOnly: true }),
    () => getServices({ activeOnly: true }),
    { enabled: open }
  )
  const services = servicesQuery.data ?? []

  useEffect(() => {
    if (examTypesQuery.isError || prescriptionItemsQuery.isError || frequenciesQuery.isError) {
      toast.warning('Some lookup data failed to load — please refresh if dropdowns appear empty')
    }
  }, [examTypesQuery.isError, prescriptionItemsQuery.isError, frequenciesQuery.isError])

  // Resolve the ortho flag for the picker if the caller didn't pass it in.
  // §2.7 — "Ortho" is a tag now, not a patient column.
  const orthoPatientQuery = useApiQuery(
    queryKeys.patients.detail(patientId),
    () =>
      api.get<{ tags?: Array<{ name?: string; systemKey?: string | null }> }>(
        `/api/patients/${patientId}`
      ),
    { enabled: open && isOrthoProp == null }
  )
  const isOrtho =
    isOrthoProp ?? (orthoPatientQuery.data ? isOrthoPatient(orthoPatientQuery.data.tags) : false)

  useEffect(() => {
    if (!open || !editStage) return
    // Map legacy "medication" type to "prescription" so it renders correctly
    const incomingType =
      editStage.stageType === 'medication' ? 'prescription' : (editStage.stageType as StageType)
    setStageType(incomingType)
    setVisitDate(editStage.visitDate ?? new Date(editStage.createdAt).toISOString().slice(0, 10))
    setPlanItemId(editStage.planItemId ?? '')
    const d = editStage.data
    if (editStage.stageType === 'examination') {
      const subType = (d as Record<string, unknown>).subType
      if (subType === 'chart') {
        setChartData(d)
        setExamTab('chart')
      } else {
        setFormData(d)
        setExamTab('diagnosis')
      }
    } else {
      setFormData(d)
    }
  }, [open, editStage])

  function reset() {
    setStageType(null)
    setFormData({})
    setChartData({})
    setExamTab(null)
    setStageStatusChanges({})
    setVisitDate(todayStr)
  }

  function selectStageType(type: StageType) {
    setStageType(type)
    setFormData({})
    setChartData({})
    setExamTab(null)
    setStageStatusChanges({})
  }

  /** `override` is set only on the retry after an admin confirms the audited
   *  treatment-gate override. */
  async function handleSave(override?: OverridePayload) {
    if (!stageType) return

    let data: Record<string, unknown>
    if (stageType === 'examination') {
      data =
        examTab === 'chart'
          ? { subType: 'chart', ...chartData }
          : { subType: 'diagnosis', ...formData }
    } else if (stageType === 'review') {
      data = { ...formData }
    } else {
      data = formData
    }

    // Inputs are intentionally optional — flexible record taking — so no field
    // is required. The examination sub-type is a render-mode choice (which
    // sub-form to show), not a data field, so it's still selected first.
    if (stageType === 'examination' && !examTab) {
      toast.error('Please select an examination type — Gen. Findings or Dental Chart')
      return
    }
    if (stageType === 'treatment_plan') {
      const stages = data.stages as TreatmentStage[] | undefined
      // Map frontend TreatmentEntry shape → backend's expected shape:
      // serviceName → procedureName, finalCost → estimatedCost
      data = {
        ...data,
        stages: (stages ?? []).map((s) => ({
          ...s,
          entries: s.entries.map((e) => ({
            procedureName: e.serviceName || e.procedureName || 'Treatment',
            treatmentTypeId: e.treatmentTypeId ?? null,
            estimatedCost: e.finalCost ?? e.estimatedCost ?? e.cost ?? 0,
            notes: e.notes ?? null,
            // preserve new fields in the JSONB blob for display
            serviceId: e.serviceId,
            serviceName: e.serviceName,
            cost: e.cost,
            discount: e.discount,
            finalCost: e.finalCost,
          })),
        })),
      }
    }

    await submit(async () => {
      const finalPlanItemId = planItemId && planItemId !== 'unlinked' ? planItemId : null
      const res = editStage
        ? await api.patch<CaseStage>(`/api/patient-cases/${caseId}/stages/${editStage.id}`, {
            data,
            visitDate,
            planItemId: finalPlanItemId,
          })
        : await api.post<CaseStage>(`/api/patient-cases/${caseId}/stages`, {
            stageType,
            data,
            visitDate,
            planItemId: finalPlanItemId,
            ...(override ?? {}),
          })

      if (res.success && res.data) {
        // §5.2 — after saving a review, also PATCH any stage status changes from the board
        if (stageType === 'review' && Object.keys(stageStatusChanges).length > 0) {
          await Promise.all(
            Object.entries(stageStatusChanges).map(([stageId, status]) =>
              api.patch(`/api/patient-cases/${caseId}/stages/${stageId}`, { status })
            )
          ).catch(() => {
            toast.warning('Review saved — some stage status updates may not have applied')
          })
        }
        reset()
        onSuccess(res.data as CaseStage)
      } else {
        // A gated stage (currently `prescription`) comes back 402 from the
        // treatment payment gate. Offer an admin the audited override rather
        // than a dead end; everyone else gets the server's reason.
        const offered = !override && promptOverride(res, (payload) => handleSave(payload))
        if (!offered) {
          surfaceApiError(res, editStage ? 'Failed to update stage' : 'Failed to add stage')
        }
      }
    })
  }

  const isEdit = !!editStage
  const visibleStageOptions = STAGE_OPTIONS.filter((opt) => !opt.orthoOnly || isOrtho)

  let saveLabel = isEdit ? 'Update stage' : 'Save stage'
  if (stageType === 'examination' && examTab) {
    saveLabel = isEdit
      ? `Update ${examTab === 'chart' ? 'chart' : 'findings'}`
      : `Save ${examTab === 'chart' ? 'chart' : 'findings'}`
  }
  if (stageType === 'review') {
    saveLabel = isEdit ? 'Update review' : 'Save review'
  }

  function renderForm() {
    if (!stageType) return null
    switch (stageType) {
      case 'patient_concern':
        return (
          <ItemsAndNotesForm
            value={formData}
            onChange={setFormData}
            lookupType="presenting-complaints"
            itemsLabel="Presenting complaint"
            placeholder="Select complaint(s)…"
            notesPlaceholder="What the patient is saying in their own words…"
          />
        )
      case 'presenting_complaint':
        return (
          <ItemsAndNotesForm
            value={formData}
            onChange={setFormData}
            lookupType="presenting-complaints"
            itemsLabel="Presenting complaint"
            placeholder="Select complaint(s)…"
            notesPlaceholder="What the patient is saying in their own words…"
          />
        )
      case 'history_of_presenting_complaint':
        return (
          <ItemsAndNotesForm
            value={formData}
            onChange={setFormData}
            lookupType="presenting-complaints"
            itemsLabel="History of presenting complaint"
            placeholder="Select prior complaint(s)…"
            notesPlaceholder="Onset, duration, prior episodes…"
          />
        )
      case 'past_medical_surgical_history':
      case 'oral_health':
        return (
          <ItemsAndNotesForm
            value={formData}
            onChange={setFormData}
            lookupType="past-medical-history"
            itemsLabel="Past medical & surgical history"
            placeholder="Select conditions / procedures…"
            notesPlaceholder="Dates, hospitals, complications…"
          />
        )
      case 'drug_history_allergies':
        return <DrugHistoryAllergiesForm value={formData} onChange={setFormData} />
      case 'social_history':
        return (
          <ItemsAndNotesForm
            value={formData}
            onChange={setFormData}
            lookupType="social-history-items"
            itemsLabel="Social history"
            placeholder="Select items…"
            notesPlaceholder="Smoking pack-years, occupation, etc."
          />
        )
      case 'diagnosis':
        return <DiagnosisForm value={formData} onChange={setFormData} />
      case 'examination':
        return (
          <ExaminationForm
            diagnosisValue={formData}
            onDiagnosisChange={setFormData}
            chartValue={chartData}
            onChartChange={setChartData}
            activeTab={examTab}
            onTabChange={(t) => setExamTab(t)}
            examTypes={examTypes}
            patientId={patientId}
          />
        )
      case 'treatment_plan':
        return <TreatmentPlanForm value={formData} onChange={setFormData} services={services} />
      // @ts-expect-error legacy type fallback
      case 'medication':
      case 'prescription':
        return (
          <PrescriptionForm
            value={formData}
            onChange={setFormData}
            inventory={inventory}
            dosageUnits={dosageUnits}
            freqPeriods={frequencies.map((f) => f.displayName ?? f.name)}
          />
        )
      case 'review':
        return (
          <ReviewStageForm
            value={formData}
            onChange={setFormData}
            caseId={caseId}
            patientId={patientId}
            isOrtho={isOrtho}
            stageStatusChanges={stageStatusChanges}
            onStageStatusChange={setStageStatusChanges}
          />
        )
      // legacy v1 review stages — kept editable/readable for existing cases
      case 'dental_review':
        return (
          <ItemsAndNotesForm
            value={formData}
            onChange={setFormData}
            lookupType="dental-review-items"
            itemsLabel="Review feedback"
            placeholder="Select feedback items…"
            notesPlaceholder="Patient feedback, progress…"
          />
        )
      case 'ortho_review':
        return <OrthoReviewForm value={formData} onChange={setFormData} patientId={patientId} />
      default:
        return null
    }
  }

  const currentLabel = STAGE_OPTIONS.find((o) => o.value === stageType)?.label ?? stageType ?? ''

  const isDirty = Object.keys(formData).length > 0 || Object.keys(chartData).length > 0

  function handleClose() {
    reset()
    onOpenChange(false)
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: handleClose,
  })

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOnOpenChange}>
        <SheetContent className="w-full sm:!max-w-[40vw] flex flex-col p-0 overflow-hidden">
          <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <SheetTitle>{isEdit ? 'Edit stage' : 'Add stage'}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 pt-4 pb-4">
            {isEdit ? (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">{currentLabel}</p>
                <VisitDateField value={visitDate} onChange={setVisitDate} max={todayStr} />
                {planItems && planItems.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Related Plan Item</Label>
                    <Select value={planItemId} onValueChange={setPlanItemId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select plan item (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None / Unlinked</SelectItem>
                        {planItems.map((pi) => (
                          <SelectItem key={pi.id} value={pi.id}>
                            {pi.procedureName} {pi.status === 'completed' ? '(Completed)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {renderForm()}
              </div>
            ) : !stageType ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Select a stage type to add</p>
                {visibleStageOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className="w-full flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                    onClick={() => selectStageType(opt.value)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => {
                      setStageType(null)
                      setFormData({})
                    }}
                  >
                    ← Back
                  </button>
                  <span className="text-xs text-muted-foreground">›</span>
                  <p className="text-sm font-medium">{currentLabel}</p>
                </div>
                <VisitDateField value={visitDate} onChange={setVisitDate} max={todayStr} />
                {planItems && planItems.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Related Plan Item</Label>
                    <Select value={planItemId} onValueChange={setPlanItemId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select plan item (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unlinked">None / Unlinked</SelectItem>
                        {planItems.map((pi) => (
                          <SelectItem key={pi.id} value={pi.id}>
                            {pi.procedureName} {pi.status === 'completed' ? '(Completed)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {renderForm()}
              </div>
            )}
          </div>

          {stageType && (
            <SheetFooter className="px-6 py-4 border-t bg-background shrink-0">
              <Button
                variant="outline"
                onClick={() => guardedOnOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button onClick={() => handleSave()} disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : saveLabel}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />

      {overrideDialog}
    </>
  )
}
