import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useToothNotation } from '@/features/clinical/use-clinical-preferences'
import { api } from '@/lib/api-client'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
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
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { ghs } from './shared'

type DraftItem = {
  uid: string
  serviceId?: string | null
  procedureName: string
  toothNumber: number | null
  phase: number
  estimatedCost: number
  notes: string
}

type EstimateLine = {
  id?: string
  serviceId?: string | null
  description?: string | null
  serviceName?: string | null
  toothNumber?: number | null
  phase?: number | null
  lineTotal?: number | string | null
  notes?: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName: string
  estimateInvoiceId: string | null
  onCreated: () => void
}

const PHASES = [1, 2, 3, 4, 5]
const TEETH = [
  ...Array.from({ length: 8 }, (_, i) => 11 + i),
  ...Array.from({ length: 8 }, (_, i) => 21 + i),
  ...Array.from({ length: 8 }, (_, i) => 31 + i),
  ...Array.from({ length: 8 }, (_, i) => 41 + i),
]

function emptyItem(): DraftItem {
  return {
    uid: crypto.randomUUID(),
    serviceId: null,
    procedureName: '',
    toothNumber: null,
    phase: 1,
    estimatedCost: 0,
    notes: '',
  }
}

export function CreateTreatmentPlanSheet({
  open,
  onOpenChange,
  patientId,
  patientName,
  estimateInvoiceId,
  onCreated,
}: Props) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const { toothLabel } = useToothNotation()
  const [loading, setLoading] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()

  useEffect(() => {
    if (!open) return
    setTitle('')
    setNotes('')
    setItems([])

    if (!estimateInvoiceId) {
      setLoading(false)
      return
    }

    setLoading(true)
    api
      .get<{ invoiceNumber?: string | null; lines?: EstimateLine[] }>(
        `/api/invoices/${estimateInvoiceId}`
      )
      .then((res) => {
        setLoading(false)
        if (!res.success || !res.data) return
        const inv = res.data
        const seeded = (inv.lines || []).map((l) => ({
          uid: crypto.randomUUID(),
          serviceId: l.serviceId ?? null,
          procedureName: l.description || l.serviceName || '',
          toothNumber: l.toothNumber ?? null,
          phase: l.phase ?? 1,
          estimatedCost: Number(l.lineTotal) || 0,
          notes: l.notes ?? '',
        }))
        setItems(seeded)
        setTitle(inv.invoiceNumber ? `Plan from ${inv.invoiceNumber}` : 'Treatment plan')
      })
  }, [open, estimateInvoiceId])

  const total = useMemo(
    () => items.reduce((s, i) => s + (Number(i.estimatedCost) || 0), 0),
    [items]
  )

  function addItem() {
    setItems((prev) => [...prev, emptyItem()])
  }

  function removeItem(uid: string) {
    setItems((prev) => prev.filter((it) => it.uid !== uid))
  }

  function updateItem(uid: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it) => (it.uid === uid ? { ...it, ...patch } : it)))
  }

  function handleSubmit() {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }
    if (items.length === 0) {
      toast.error('Add at least one procedure')
      return
    }
    if (items.some((it) => !it.procedureName.trim())) {
      toast.error('Every procedure needs a name')
      return
    }

    void submit(async () => {
      const payload = {
        patientId,
        title: title.trim(),
        notes: notes.trim() || null,
        items: items.map((it) => ({
          serviceId: it.serviceId,
          procedureName: it.procedureName.trim(),
          toothNumber: it.toothNumber,
          phase: it.phase,
          estimatedCost: Number(it.estimatedCost) || 0,
          notes: it.notes.trim() || null,
        })),
      }

      const res = await api.post('/api/treatment-plans', payload)
      if (!res.success) {
        toast.error(res.error || 'Failed to create treatment plan')
        return
      }
      toast.success('Treatment plan created')
      onOpenChange(false)
      onCreated()
    })
  }

  return (
    <SheetFormLayout
      open={open}
      onOpenChange={onOpenChange}
      title={`Create treatment plan — ${patientName}`}
      description="Review the estimate, edit the procedures, and confirm to create the plan."
      size="lg"
      submitLabel={isSubmitting ? 'Creating…' : 'Confirm treatment plan'}
      submitting={isSubmitting}
      submitDisabled={isSubmitting || items.length === 0}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
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
              <Input
                id="plan-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Clinical rationale, priorities..."
                maxLength={2000}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Procedures</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add procedure
                </Button>
              </div>

              {items.length === 0 ? (
                <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                  No procedures added yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {items.map((it) => (
                    <div key={it.uid} className="rounded-md border border-border p-3 space-y-2">
                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-12 md:col-span-5">
                          <Label className="text-xs">Procedure</Label>
                          <Input
                            value={it.procedureName}
                            onChange={(e) => updateItem(it.uid, { procedureName: e.target.value })}
                            placeholder="e.g. Composite filling"
                            maxLength={200}
                          />
                        </div>
                        <div className="col-span-4 md:col-span-2">
                          <Label className="text-xs">Tooth</Label>
                          <Select
                            value={it.toothNumber?.toString() ?? 'none'}
                            onValueChange={(v) =>
                              updateItem(it.uid, {
                                toothNumber: v === 'none' ? null : parseInt(v, 10),
                              })
                            }
                          >
                            <SelectTrigger>
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
                          <Label className="text-xs">Phase</Label>
                          <Select
                            value={it.phase.toString()}
                            onValueChange={(v) => updateItem(it.uid, { phase: parseInt(v, 10) })}
                          >
                            <SelectTrigger>
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
                          <Label className="text-xs">Cost (GHS)</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={it.estimatedCost}
                            onChange={(e) =>
                              updateItem(it.uid, { estimatedCost: parseFloat(e.target.value) || 0 })
                            }
                          />
                        </div>
                        <div className="col-span-12 md:col-span-1 flex items-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => removeItem(it.uid)}
                            aria-label="Remove procedure"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Notes</Label>
                        <Input
                          value={it.notes}
                          onChange={(e) => updateItem(it.uid, { notes: e.target.value })}
                          placeholder="Optional procedure note"
                          maxLength={500}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
              <span className="text-sm text-muted-foreground">Estimated total</span>
              <span className="text-lg font-semibold">{ghs(total)}</span>
            </div>
          </>
        )}
      </div>
    </SheetFormLayout>
  )
}
