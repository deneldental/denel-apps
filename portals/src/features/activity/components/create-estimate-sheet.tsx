import { Loader2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getServiceMatrix, getServices, type ServiceMatrix } from '@/lib/actions/services'
import { createEstimate, createStandaloneEstimate } from '@/lib/actions/worklist'
import type { ApiResponse } from '@/lib/api-client'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { PatientPicker } from '@/shared/components/patient-picker'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
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
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Textarea } from '@/shared/components/ui/textarea'
import { inputToCents } from '@/shared/utils/currency'
import { ghs } from './shared'

/**
 * Local key for the "load an existing draft estimate for editing" compound
 * fetch (invoice + a getServiceMatrix call per line). Not the canonical
 * invoice-detail resource — it resolves a component-specific shape — so it
 * does not reuse `queryKeys.invoices.detail`.
 */
const estimateEditKey = (estimateInvoiceId: string) =>
  ['activity', 'estimate-edit', estimateInvoiceId] as const

type ServiceOption = {
  id: string
  name: string
  amount: number
  category: string
  discountEligible?: boolean
}

interface EstimateLine {
  key: string
  serviceId: string
  name: string
  baseAmount: number
  matrix: ServiceMatrix | null
  variantName: string // '' = none
  toothClassId: string // '' = Any
  quantity: number
  discountEligible: boolean
  surchargeType: 'none' | 'percent' | 'amount'
  surchargeValue: number
  discountType: 'none' | 'percent' | 'amount'
  discountValue: number
  discountReason: string
}

const ANY = '__any__'

/** A surcharge more than doubling the line — likely a fat-fingered value
 *  (500 instead of 50, 500% instead of 50%) rather than an intentional one. */
const SURCHARGE_CONFIRM_RATIO = 1

/** Client-side mirror of the backend matrix resolver — for the live preview.
 *  Order mirrors `computeLine` on the backend: surcharge applies to the
 *  catalog subtotal first, then discount nets against the surcharged gross. */
function preview(line: EstimateLine): {
  unitPrice: number
  quantity: number
  surchargeAmount: number
  discountAmount: number
  needsConfirm: boolean
} {
  const m = line.matrix

  let unitPrice: number
  let qty: number
  if (!m || m.cells.length === 0) {
    unitPrice = line.baseAmount
    qty = line.quantity
  } else {
    const active = m.cells.filter((c) => c.isActive)
    const v = line.variantName || null
    const t = line.toothClassId || null
    const cell =
      active.find((c) => (c.variantName ?? null) === v && (c.toothClassId ?? null) === t) ??
      active.find((c) => (c.variantName ?? null) === v && c.toothClassId == null) ??
      active.find((c) => c.variantName == null && (c.toothClassId ?? null) === t) ??
      active.find((c) => c.variantName == null && c.toothClassId == null) ??
      null
    unitPrice = cell ? Number(cell.price) : line.baseAmount
    const scope = m.scope
    qty = line.quantity
    if (!scope || scope.quantityMode === 'single') qty = 1
    else if (scope.maxQuantity != null && qty > scope.maxQuantity) qty = scope.maxQuantity
    if (qty < 1) qty = 1
  }

  const subtotal = unitPrice * qty
  const surchargeAmount =
    line.surchargeType === 'percent'
      ? Math.round((subtotal * line.surchargeValue) / 100)
      : line.surchargeType === 'amount'
        ? inputToCents(line.surchargeValue)
        : 0
  const gross = subtotal + surchargeAmount
  const discountAmount =
    line.discountType === 'percent'
      ? Math.round((gross * line.discountValue) / 100)
      : line.discountType === 'amount'
        ? Math.min(inputToCents(line.discountValue), gross)
        : 0

  return {
    unitPrice,
    quantity: qty,
    surchargeAmount,
    discountAmount,
    needsConfirm: subtotal > 0 && surchargeAmount > subtotal * SURCHARGE_CONFIRM_RATIO,
  }
}

interface Props {
  appointmentId?: string
  patientId?: string
  patientName?: string
  estimateInvoiceId?: string | null
  planId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

/**
 * Create-estimate dialog (build plan P3). The doctor picks services and, per line,
 * a variant / tooth-class / quantity from the pricing matrix; the total previews
 * live. Submitting builds a draft-invoice estimate the reception later confirms.
 */
export function CreateEstimateSheet({
  appointmentId,
  patientId,
  patientName,
  estimateInvoiceId,
  planId,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const [lines, setLines] = useState<EstimateLine[]>([])
  const [note, setNote] = useState('')
  const [visitFrequency, setVisitFrequency] = useState<'single' | 'multiple'>('single')
  const [saving, setSaving] = useState(false)
  const [localPatientId, setLocalPatientId] = useState<string | null>(patientId ?? null)

  useEffect(() => {
    if (open) {
      setLocalPatientId(patientId ?? null)
    }
  }, [open, patientId])

  const servicesQuery = useApiQuery(
    queryKeys.services.list({ activeOnly: true }),
    () => getServices({ activeOnly: true }),
    { enabled: open }
  )
  const services = useMemo(() => {
    const rows = (servicesQuery.data as ServiceOption[] | undefined) ?? []
    return rows
      .filter((s) => s.category !== 'insurance')
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [servicesQuery.data])

  // Loads an existing draft estimate for editing: fetch the invoice, then
  // resolve the pricing matrix for each of its lines.
  const editQuery = useApiQuery(
    estimateEditKey(estimateInvoiceId ?? ''),
    async (): Promise<
      ApiResponse<{ lines: EstimateLine[]; visitFrequency: 'single' | 'multiple' }>
    > => {
      const res = await api.get<any>(`/api/invoices/${estimateInvoiceId}`)
      if (!res.success || !res.data?.lines) {
        return { success: false, error: res.error || 'Failed to load estimate' }
      }
      const invLines = res.data.lines
      const loadedLines = await Promise.all(
        invLines.map(async (l: any, i: number) => {
          const mRes = await getServiceMatrix(l.serviceId)
          return {
            key: `${l.serviceId}-${i}`,
            serviceId: l.serviceId,
            name: l.description || '',
            baseAmount: Number(l.unitPrice) || 0,
            matrix: mRes.success ? (mRes.data ?? null) : null,
            variantName: l.variantName || '',
            toothClassId: l.toothClassId || '',
            quantity: Number(l.quantity) || 1,
            discountEligible: true, // Legacy lines might not have it, default true
            discountType: 'none' as const,
            discountValue: 0,
            discountReason: '',
          }
        })
      )
      return {
        success: true,
        // The note field is currently mapped to invoice.description conceptually, or could be empty
        // depending on how it was saved.
        data: { lines: loadedLines, visitFrequency: res.data.visitFrequency || 'single' },
      }
    },
    { enabled: open && !!estimateInvoiceId }
  )

  useEffect(() => {
    if (!open) {
      setLines([])
      setNote('')
      return
    }
    if (estimateInvoiceId && editQuery.data) {
      setLines(editQuery.data.lines)
      setVisitFrequency(editQuery.data.visitFrequency)
    }
  }, [open, estimateInvoiceId, editQuery.data])

  const addService = useCallback(
    async (serviceId: string) => {
      const svc = services.find((s) => s.id === serviceId)
      if (!svc || lines.some((l) => l.serviceId === serviceId)) return
      const key = `${serviceId}-${lines.length}`
      setLines((prev) => [
        ...prev,
        {
          key,
          serviceId,
          name: svc.name,
          baseAmount: Number(svc.amount) || 0,
          matrix: null,
          variantName: '',
          toothClassId: '',
          quantity: 1,
          discountEligible: svc.discountEligible ?? false,
          surchargeType: 'none',
          surchargeValue: 0,
          discountType: 'none',
          discountValue: 0,
          discountReason: '',
        },
      ])
      const res = await getServiceMatrix(serviceId)
      if (res.success && res.data) {
        setLines((prev) =>
          prev.map((l) => (l.serviceId === serviceId ? { ...l, matrix: res.data ?? null } : l))
        )
      }
    },
    [services, lines]
  )

  const setLine = (key: string, patch: Partial<EstimateLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const p = preview(l)
        return sum + Math.max(0, p.unitPrice * p.quantity + p.surchargeAmount - p.discountAmount)
      }, 0),
    [lines]
  )

  const [confirmSurchargeOpen, setConfirmSurchargeOpen] = useState(false)

  function handleSubmit() {
    if (lines.length === 0) {
      toast.error('Add at least one service')
      return
    }
    if (lines.some((l) => preview(l).needsConfirm)) {
      setConfirmSurchargeOpen(true)
      return
    }
    void doCreate()
  }

  async function doCreate() {
    setSaving(true)

    const targetPatientId = localPatientId || patientId

    const isStandalone = !appointmentId || (localPatientId && localPatientId !== patientId)

    if (isStandalone && !targetPatientId) {
      toast.error('Please select a patient')
      setSaving(false)
      return
    }

    const mappedLines = lines.map((l) => ({
      serviceId: l.serviceId,
      variantName: l.variantName || null,
      toothClassId: l.toothClassId || null,
      quantity: preview(l).quantity,
      surcharge:
        l.surchargeType !== 'none' && l.surchargeValue > 0
          ? {
              type: l.surchargeType as 'percent' | 'amount',
              value:
                l.surchargeType === 'amount' ? inputToCents(l.surchargeValue) : l.surchargeValue,
            }
          : null,
      discount:
        l.discountType !== 'none' && l.discountValue > 0
          ? {
              type: l.discountType as 'percent' | 'amount',
              value: l.discountType === 'amount' ? inputToCents(l.discountValue) : l.discountValue,
              reason: l.discountReason || null,
            }
          : null,
    }))

    const res =
      !isStandalone && appointmentId
        ? await createEstimate(appointmentId, mappedLines, note.trim() || null, visitFrequency)
        : await createStandaloneEstimate(
            targetPatientId!,
            mappedLines,
            note.trim() || null,
            visitFrequency,
            planId
          )

    setSaving(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to create estimate')
      return
    }
    toast.success(
      appointmentId ? 'Estimate ready — sent to reception.' : 'Estimate created successfully.'
    )
    onOpenChange(false)
    onCreated()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>Create estimate{patientName ? ` — ${patientName}` : ''}</SheetTitle>
          <SheetDescription>
            Pick services and set the variant, tooth class, and quantity. The total previews live.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 pt-4">
          {!planId && !patientId && (
            <div className="space-y-1.5">
              <Label>Patient</Label>
              <PatientPicker
                value={localPatientId ?? ''}
                onChange={(id) => setLocalPatientId(id)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Add service</Label>
            <Select value="" onValueChange={addService}>
              <SelectTrigger>
                <SelectValue placeholder="Add a service from the catalog…" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem
                    key={s.id}
                    value={s.id}
                    disabled={lines.some((l) => l.serviceId === s.id)}
                  >
                    {s.name} · {ghs(s.amount)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
              No services added yet.
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map((line) => {
                const p = preview(line)
                const m = line.matrix
                const hasVariants = (m?.variants.length ?? 0) > 0
                const hasClass = m?.cells.some((c) => c.toothClassId) ?? false
                const multiQty = m?.scope?.quantityMode === 'multi'
                return (
                  <div key={line.key} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{line.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {ghs(p.unitPrice)} × {p.quantity} = {ghs(p.unitPrice * p.quantity)}
                          {p.surchargeAmount > 0 && (
                            <span
                              className={
                                p.needsConfirm
                                  ? 'ml-1 font-medium text-destructive'
                                  : 'ml-1 text-blue-600'
                              }
                            >
                              · surcharge: +{ghs(p.surchargeAmount)}
                            </span>
                          )}
                          {p.discountAmount > 0 && (
                            <span className="ml-1 text-orange-600">
                              · discount: -{ghs(p.discountAmount)}
                            </span>
                          )}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                        aria-label="Remove"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    {(hasVariants || hasClass || multiQty) && (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {hasVariants && (
                          <div className="space-y-1">
                            <Label className="text-[11px]">Variant</Label>
                            <Select
                              value={line.variantName || ANY}
                              onValueChange={(v) =>
                                setLine(line.key, { variantName: v === ANY ? '' : v })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={ANY}>Default</SelectItem>
                                {m?.variants.map((v) => (
                                  <SelectItem key={v} value={v}>
                                    {v}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {hasClass && (
                          <div className="space-y-1">
                            <Label className="text-[11px]">Tooth class</Label>
                            <Select
                              value={line.toothClassId || ANY}
                              onValueChange={(v) =>
                                setLine(line.key, { toothClassId: v === ANY ? '' : v })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={ANY}>Any</SelectItem>
                                {m?.toothClasses.map((tc) => (
                                  <SelectItem key={tc.id} value={tc.id}>
                                    {tc.displayName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {multiQty && (
                          <div className="space-y-1">
                            <Label className="text-[11px]">
                              Qty{m?.scope?.maxQuantity ? ` (max ${m.scope.maxQuantity})` : ''}
                            </Label>
                            <Input
                              type="number"
                              min="1"
                              max={m?.scope?.maxQuantity ?? undefined}
                              value={line.quantity}
                              onChange={(e) =>
                                setLine(line.key, {
                                  quantity: Math.max(1, Number(e.target.value) || 1),
                                })
                              }
                              className="h-8"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 rounded bg-muted/30 p-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Surcharge Type</Label>
                        <Select
                          value={line.surchargeType}
                          onValueChange={(v: 'none' | 'percent' | 'amount') =>
                            setLine(line.key, {
                              surchargeType: v,
                              surchargeValue: v === 'none' ? 0 : line.surchargeValue,
                            })
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="percent">Percent (%)</SelectItem>
                            <SelectItem value="amount">Amount (GHS)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {line.surchargeType !== 'none' && (
                        <div className="space-y-1 sm:col-span-3">
                          <Label className="text-[11px]">Value</Label>
                          <Input
                            type="number"
                            min="0"
                            value={line.surchargeValue}
                            onChange={(e) =>
                              setLine(line.key, {
                                surchargeValue: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="h-8"
                          />
                        </div>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 rounded bg-muted/30 p-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Discount Type</Label>
                        <Select
                          value={line.discountType}
                          onValueChange={(v: 'none' | 'percent' | 'amount') =>
                            setLine(line.key, {
                              discountType: v,
                              discountValue: v === 'none' ? 0 : line.discountValue,
                            })
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="percent">Percent (%)</SelectItem>
                            <SelectItem value="amount">Amount (GHS)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {line.discountType !== 'none' && (
                        <>
                          <div className="space-y-1">
                            <Label className="text-[11px]">Value</Label>
                            <Input
                              type="number"
                              min="0"
                              value={line.discountValue}
                              onChange={(e) =>
                                setLine(line.key, {
                                  discountValue: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              className="h-8"
                            />
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <Label className="text-[11px]">Reason (optional)</Label>
                            <Input
                              value={line.discountReason}
                              onChange={(e) =>
                                setLine(line.key, { discountReason: e.target.value })
                              }
                              className="h-8"
                              placeholder="e.g. VIP"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything reception should know…"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Visit frequency</Label>
            <div className="flex bg-muted p-1 rounded-lg w-fit">
              <button
                type="button"
                className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
                  visitFrequency === 'single'
                    ? 'bg-background shadow text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setVisitFrequency('single')}
              >
                Single visit
              </button>
              <button
                type="button"
                className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
                  visitFrequency === 'multiple'
                    ? 'bg-background shadow text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setVisitFrequency('multiple')}
              >
                Multiple visits
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
            <span className="text-sm text-muted-foreground">Estimated total</span>
            <span className="text-lg font-semibold">{ghs(total)}</span>
          </div>
          <div className="flex items-center justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                saving || lines.length === 0 || (!localPatientId && !patientId && !appointmentId)
              }
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create estimate
            </Button>
          </div>
        </div>
      </SheetContent>

      <DeleteConfirmationDialog
        open={confirmSurchargeOpen}
        onOpenChange={setConfirmSurchargeOpen}
        onConfirm={doCreate}
        tone="default"
        confirmLabel="Add anyway"
        title="Large surcharge"
        description="One or more surcharges more than double a line's standard price. Double-check the entered value before continuing — this can't be undone once the estimate is sent to reception."
      />
    </Sheet>
  )
}
