import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react'
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
import { centsToInput, inputToCents } from '@/shared/utils/currency'
import { ghs } from './shared'

type DraftItem = {
  uid: string
  serviceId?: string | null
  /**
   * The estimate line this procedure was seeded from. Its price is the quoted
   * `estimatedCost` (cents) and cannot be edited: the server prices it from the
   * estimate (decision D12). Null for a procedure added by hand.
   */
  sourceLineId: string | null
  procedureName: string
  toothNumber: number | null
  phase: number
  /** Integer CENTS — the quoted line total for a seeded procedure. */
  estimatedCost: number
  /** What the user typed in the Cost (GHS) field, in cedis, for a hand-added procedure. */
  costInput: string
  notes: string
}

/** The procedure's cost in cents: the quote for a seeded line, the typed cedis otherwise. */
function itemCents(it: DraftItem): number {
  return it.sourceLineId ? it.estimatedCost : inputToCents(it.costInput)
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
    sourceLineId: null,
    procedureName: '',
    toothNumber: null,
    phase: 1,
    estimatedCost: 0,
    costInput: '',
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
  const [loadError, setLoadError] = useState<string | null>(null)
  // Set only once the estimate has loaded: a plan built by hand after a failed load
  // must not claim to come from it.
  const [seededFrom, setSeededFrom] = useState<string | null>(null)
  const { isSubmitting, submit } = useSubmitGuard()

  useEffect(() => {
    if (!open) return
    setTitle('')
    setNotes('')
    setItems([])
    setLoadError(null)
    setSeededFrom(null)

    if (!estimateInvoiceId) {
      setLoading(false)
      return
    }

    // Seed from the clinical estimate endpoint (a doctor may call it; the invoice
    // endpoint needs payment access and used to fail here with no explanation).
    // A response that arrives after the sheet closed or switched estimate is stale.
    let current = true
    setLoading(true)
    api
      .get<{ invoiceNumber?: string | null; lines?: EstimateLine[] }>(
        `/api/estimates/${estimateInvoiceId}`
      )
      .then((res) => {
        if (!current) return
        setLoading(false)
        if (!res.success || !res.data) {
          setLoadError(res.error || 'Please try again.')
          return
        }
        const inv = res.data
        const seeded = (inv.lines || []).map((l) => ({
          uid: crypto.randomUUID(),
          serviceId: l.serviceId ?? null,
          sourceLineId: l.id ?? null,
          procedureName: l.description || l.serviceName || '',
          toothNumber: l.toothNumber ?? null,
          phase: l.phase ?? 1,
          estimatedCost: Number(l.lineTotal) || 0,
          costInput: centsToInput(l.lineTotal),
          notes: l.notes ?? '',
        }))
        setItems(seeded)
        setSeededFrom(estimateInvoiceId)
        setTitle(inv.invoiceNumber ? `Plan from ${inv.invoiceNumber}` : 'Treatment plan')
      })
      .catch((err: unknown) => {
        if (!current) return
        setLoading(false)
        setLoadError(err instanceof Error && err.message ? err.message : 'Please try again.')
      })
    return () => {
      current = false
    }
  }, [open, estimateInvoiceId])

  const total = useMemo(() => items.reduce((s, i) => s + itemCents(i), 0), [items])

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
        // D12: the server prices each seeded procedure from this estimate's line.
        ...(seededFrom ? { sourceInvoiceId: seededFrom } : {}),
        items: items.map((it) => ({
          serviceId: it.serviceId,
          sourceLineId: it.sourceLineId,
          procedureName: it.procedureName.trim(),
          toothNumber: it.toothNumber,
          phase: it.phase,
          // Integer cents. A typed cost is in cedis (F37: it used to be posted as typed,
          // so "120" became GH₵1.20).
          estimatedCost: itemCents(it),
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
            {loadError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium">Could not load the estimate.</p>
                  <p className="text-xs text-muted-foreground">
                    {loadError} You can still add the procedures by hand.
                  </p>
                </div>
              </div>
            )}
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
                          <Label htmlFor={`plan-cost-${it.uid}`} className="text-xs">
                            Cost (GHS)
                          </Label>
                          {it.sourceLineId ? (
                            <>
                              <Input
                                id={`plan-cost-${it.uid}`}
                                type="number"
                                value={centsToInput(it.estimatedCost)}
                                disabled
                                readOnly
                              />
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                Quoted on the estimate
                              </p>
                            </>
                          ) : (
                            <Input
                              id={`plan-cost-${it.uid}`}
                              type="number"
                              min={0}
                              step="0.01"
                              value={it.costInput}
                              onChange={(e) => updateItem(it.uid, { costInput: e.target.value })}
                            />
                          )}
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
