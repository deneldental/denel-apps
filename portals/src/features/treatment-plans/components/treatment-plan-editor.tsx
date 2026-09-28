import { cedisToCents } from '@denel/utils'
import { Plus, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useToothNotation } from '@/features/clinical/use-clinical-preferences'
import { api } from '@/lib/api-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import type { TreatmentPlan } from '../types'

type DraftItem = {
  uid: string
  id?: string
  procedureName: string
  toothNumber: number | null
  phase: number
  estimatedCost: number
  notes: string
}

interface TreatmentPlanEditorProps {
  patientId: string
  plan: TreatmentPlan | null // null = new plan
  onClose: () => void
  onSaved: () => void
}

const PHASES = [1, 2, 3, 4, 5]
const TEETH = [
  ...Array.from({ length: 8 }, (_, i) => 11 + i), // Q1 upper-right
  ...Array.from({ length: 8 }, (_, i) => 21 + i), // Q2 upper-left
  ...Array.from({ length: 8 }, (_, i) => 31 + i), // Q3 lower-left
  ...Array.from({ length: 8 }, (_, i) => 41 + i), // Q4 lower-right
]

export function TreatmentPlanEditor({
  patientId,
  plan,
  onClose,
  onSaved,
}: TreatmentPlanEditorProps) {
  const { toothLabel } = useToothNotation()
  const [title, setTitle] = useState(plan?.title ?? '')
  const [notes, setNotes] = useState(plan?.notes ?? '')
  const [items, setItems] = useState<DraftItem[]>(
    plan?.items.map((i) => ({
      uid: crypto.randomUUID(),
      id: i.id,
      procedureName: i.procedureName,
      toothNumber: i.toothNumber,
      phase: i.phase,
      // The form works in CEDIS — the field is labelled "Cost (GHS)" and the
      // user types cedis. The API speaks CENTS, so convert on the way in and
      // back out again at submit. Neither conversion existed: a plan typed as
      // 1500 was stored as 1500 pesewas (GH₵15.00), and reopening it showed the
      // stored pesewas as cedis, so the two errors hid each other on screen.
      estimatedCost: i.estimatedCost / 100,
      notes: i.notes ?? '',
    })) ?? []
  )
  const { isSubmitting, submit } = useSubmitGuard()

  // Dirty tracking: form is dirty if any field differs from the initial plan state.
  const initialTitle = plan?.title ?? ''
  const initialNotes = plan?.notes ?? ''
  const initialItemCount = plan?.items.length ?? 0
  const isDirty =
    title !== initialTitle ||
    notes !== initialNotes ||
    items.length !== initialItemCount ||
    items.some(
      (it, idx) =>
        !plan ||
        it.procedureName !== (plan.items[idx]?.procedureName ?? '') ||
        it.estimatedCost !== (plan.items[idx]?.estimatedCost ?? 0) / 100
    )

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose,
  })

  const total = items.reduce((s, i) => s + (Number(i.estimatedCost) || 0), 0)

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        uid: crypto.randomUUID(),
        procedureName: '',
        toothNumber: null,
        phase: 1,
        estimatedCost: 0,
        notes: '',
      },
    ])
  }

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function save() {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }
    if (items.length === 0) {
      toast.error('Add at least one procedure')
      return
    }
    if (items.some((i) => !i.procedureName.trim())) {
      toast.error('All items need a procedure name')
      return
    }
    void submit(async () => {
      const itemsPayload = items.map((i) => ({
        procedureName: i.procedureName.trim(),
        toothNumber: i.toothNumber,
        phase: i.phase,
        estimatedCost: cedisToCents(Number(i.estimatedCost) || 0),
        notes: i.notes || null,
      }))
      const res = plan
        ? await api.patch(`/api/treatment-plans/${plan.id}`, {
            title: title.trim(),
            notes: notes || null,
            items: itemsPayload,
          })
        : await api.post('/api/treatment-plans', {
            patientId,
            title: title.trim(),
            notes: notes || null,
            items: itemsPayload,
          })
      if (res.success) {
        toast.success(plan ? 'Plan updated' : 'Plan created')
        onSaved()
      } else {
        surfaceApiError(res, 'Failed to save')
      }
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="plan-title">Title</Label>
          <Input
            id="plan-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Comprehensive Care Plan"
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="plan-notes">Notes (optional)</Label>
          <Textarea
            id="plan-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Clinical rationale, priorities..."
            maxLength={2000}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Procedures</Label>
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Procedure
            </Button>
          </div>

          {items.length === 0 ? (
            <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              No procedures added yet.
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={item.uid} className="rounded-md border border-border p-3 space-y-2">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-12 md:col-span-5">
                      <Label htmlFor={`proc-name-${item.uid}`} className="text-xs">
                        Procedure
                      </Label>
                      <Input
                        id={`proc-name-${item.uid}`}
                        value={item.procedureName}
                        onChange={(e) => updateItem(idx, { procedureName: e.target.value })}
                        placeholder="e.g. Composite filling"
                        maxLength={200}
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <Label htmlFor={`proc-tooth-${item.uid}`} className="text-xs">
                        Tooth
                      </Label>
                      <Select
                        value={item.toothNumber?.toString() ?? 'none'}
                        onValueChange={(v) =>
                          updateItem(idx, { toothNumber: v === 'none' ? null : parseInt(v, 10) })
                        }
                      >
                        <SelectTrigger id={`proc-tooth-${item.uid}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {TEETH.map((t) => (
                            <SelectItem key={t} value={t.toString()}>
                              {toothLabel(t)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <Label htmlFor={`proc-phase-${item.uid}`} className="text-xs">
                        Phase
                      </Label>
                      <Select
                        value={item.phase.toString()}
                        onValueChange={(v) => updateItem(idx, { phase: parseInt(v, 10) })}
                      >
                        <SelectTrigger id={`proc-phase-${item.uid}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PHASES.map((p) => (
                            <SelectItem key={p} value={p.toString()}>
                              Phase {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <Label htmlFor={`proc-cost-${item.uid}`} className="text-xs">
                        Cost (GHS)
                      </Label>
                      <Input
                        id={`proc-cost-${item.uid}`}
                        type="number"
                        min={0}
                        value={item.estimatedCost}
                        onChange={(e) =>
                          updateItem(idx, { estimatedCost: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </div>
                    <div className="col-span-12 md:col-span-1 flex items-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => removeItem(idx)}
                        aria-label="Delete procedure"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={`proc-notes-${item.uid}`} className="text-xs">
                      Notes
                    </Label>
                    <Input
                      id={`proc-notes-${item.uid}`}
                      value={item.notes}
                      onChange={(e) => updateItem(idx, { notes: e.target.value })}
                      placeholder="Optional procedure note"
                      maxLength={500}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-md bg-muted/30 border border-border px-4 py-3">
          <span className="text-sm font-medium">Total Estimated</span>
          <span className="text-xl font-bold">GHS {Number(total).toFixed(2)}</span>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => guardedOnOpenChange(false)}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Cancel
          </Button>
          <Button onClick={save} disabled={isSubmitting}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {isSubmitting ? 'Saving…' : plan ? 'Save Changes' : 'Create Plan'}
          </Button>
        </div>
      </div>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
