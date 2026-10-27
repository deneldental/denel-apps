import { Money } from '@denel/utils'
import { Trash2 } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useMemo } from 'react'
import { getServiceMatrix, getServices, type ServiceMatrix } from '@/lib/actions/services'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
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
import { formatCurrency, inputToCents } from '@/shared/utils/currency'

export type ServiceCatalogOption = {
  id: string
  name: string
  amount: number
  category: string
  discountEligible?: boolean
}

export interface ServiceLine {
  key: string
  serviceId: string
  name: string
  baseAmount: number
  matrix: ServiceMatrix | null
  /** The pricing options could not be loaded, so the line shows the catalogue price only. */
  matrixFailed?: boolean
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

/**
 * `percentage` per cent of `cents`, in whole pesewas. The server rounds a half pesewa to even
 * (`Money.percent`, as `computeLine` uses it), so the preview does too: `Math.round` rounds it up
 * and would show one pesewa more than is stored.
 */
function percentOf(cents: number, percentage: number): number {
  return Money.from(Math.round(cents)).percent(percentage).toDbValue()
}

export interface ServiceLinePreview {
  /** The first unit's price (the chosen variant's, else the catalogue amount). */
  unitPrice: number
  /** Price of each unit after the first, when the line is billed in steps and has more than one
   *  unit; null for a flat line (or one unit), where every unit costs `unitPrice`. */
  additionalUnitPrice: number | null
  quantity: number
  /** What the units cost before surcharge and discount. */
  subtotal: number
  surchargeAmount: number
  discountAmount: number
  total: number
  needsConfirm: boolean
}

/** Client-side mirror of the backend matrix resolver — for the live preview.
 *  Quantity follows `resolveQuantity` (service-pricing.ts) and the amounts follow `computeLine`
 *  (invoice-service.ts): surcharge applies to the catalog subtotal first, then discount nets
 *  against the surcharged gross. The server prices every stored estimate and invoice; this is
 *  only what the screen shows while the line is being built. */
export function previewServiceLine(line: ServiceLine): ServiceLinePreview {
  const m = line.matrix

  // The quantity comes from the service's application type, whether or not the service has price
  // cells: no type, or a single-quantity one, bills once; a multi-quantity one is a whole number
  // from 1 up to the type's maximum.
  let qty = line.quantity
  if (m) {
    const scope = m.scope
    if (!scope || scope.quantityMode === 'single') qty = 1
    else {
      qty = Number.isFinite(qty) ? Math.floor(qty) : 1
      if (qty < 1) qty = 1
      if (scope.maxQuantity != null && qty > scope.maxQuantity) qty = scope.maxQuantity
    }
  }

  let unitPrice: number
  if (!m || m.cells.length === 0) {
    unitPrice = line.baseAmount
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
  }

  // First-unit / additional-unit tariff (`computeLine`): stepped only while the service's type has
  // the switch on AND the service has the further-unit price; the first unit costs `unitPrice`
  // whichever variant is chosen, each further one the additional price.
  const additionalUnitPrice =
    m?.scope?.additionalUnitPriceEnabled && m.service.additionalUnitPrice != null
      ? Number(m.service.additionalUnitPrice)
      : null
  const stepped = additionalUnitPrice != null && qty > 1
  const subtotal = stepped ? unitPrice + additionalUnitPrice * (qty - 1) : unitPrice * qty
  const surchargeAmount =
    line.surchargeType === 'percent'
      ? percentOf(subtotal, line.surchargeValue)
      : line.surchargeType === 'amount'
        ? inputToCents(line.surchargeValue)
        : 0
  const gross = subtotal + surchargeAmount
  // A discount never takes a line below nothing, whichever way it is entered.
  const discountAmount = Math.min(
    line.discountType === 'percent'
      ? percentOf(gross, line.discountValue)
      : line.discountType === 'amount'
        ? inputToCents(line.discountValue)
        : 0,
    gross
  )

  return {
    unitPrice,
    additionalUnitPrice: stepped ? additionalUnitPrice : null,
    quantity: qty,
    subtotal,
    surchargeAmount,
    discountAmount,
    total: Math.max(0, subtotal + surchargeAmount - discountAmount),
    needsConfirm: subtotal > 0 && surchargeAmount > subtotal * SURCHARGE_CONFIRM_RATIO,
  }
}

export function computeServiceLinesTotal(lines: ServiceLine[]): number {
  return lines.reduce((sum, l) => sum + previewServiceLine(l).total, 0)
}

export function serviceLinesNeedSurchargeConfirm(lines: ServiceLine[]): boolean {
  return lines.some((l) => previewServiceLine(l).needsConfirm)
}

/** The catalog services eligible for a service-line picker: active, non-insurance. */
export function useServiceCatalog(enabled = true) {
  const servicesQuery = useApiQuery(
    queryKeys.services.list({ activeOnly: true }),
    () => getServices({ activeOnly: true }),
    { enabled }
  )
  return useMemo(() => {
    const rows = (servicesQuery.data as ServiceCatalogOption[] | undefined) ?? []
    return rows
      .filter((s) => s.category !== 'insurance')
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [servicesQuery.data])
}

interface ServiceLinesEditorProps {
  services: ServiceCatalogOption[]
  lines: ServiceLine[]
  setLines: Dispatch<SetStateAction<ServiceLine[]>>
  addServicePlaceholder?: string
}

/**
 * "Add a service from the catalog, then set variant / tooth class / quantity
 * and an optional surcharge or discount" line editor. Shared by the estimate
 * builder and the one-time payment sheet so both present the same catalog UX
 * instead of two divergent ones.
 */
export function ServiceLinesEditor({
  services,
  lines,
  setLines,
  addServicePlaceholder = 'Add a service from the catalog…',
}: ServiceLinesEditorProps) {
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
      // The pricing options arrive after the line is shown. If they cannot be loaded the line
      // keeps its catalogue price and says so, rather than looking like the whole price.
      let matrix: ServiceMatrix | null = null
      try {
        const res = await getServiceMatrix(serviceId)
        if (res.success && res.data) matrix = res.data
      } catch {
        // reported on the line below
      }
      setLines((prev) =>
        prev.map((l) =>
          l.serviceId === serviceId ? (matrix ? { ...l, matrix } : { ...l, matrixFailed: true }) : l
        )
      )
    },
    [services, lines, setLines]
  )

  const setLine = (key: string, patch: Partial<ServiceLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Add service</Label>
        <Select value="" onValueChange={addService}>
          <SelectTrigger>
            <SelectValue placeholder={addServicePlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {services.map((s) => (
              <SelectItem
                key={s.id}
                value={s.id}
                disabled={lines.some((l) => l.serviceId === s.id)}
              >
                {s.name} · {formatCurrency(s.amount)}
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
            const p = previewServiceLine(line)
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
                      {p.additionalUnitPrice != null
                        ? `${formatCurrency(p.unitPrice)} + ${p.quantity - 1} × ${formatCurrency(p.additionalUnitPrice)}`
                        : `${formatCurrency(p.unitPrice)} × ${p.quantity}`}{' '}
                      = {formatCurrency(p.subtotal)}
                      {p.surchargeAmount > 0 && (
                        <span
                          className={
                            p.needsConfirm
                              ? 'ml-1 font-medium text-destructive'
                              : 'ml-1 text-blue-600'
                          }
                        >
                          · surcharge: +{formatCurrency(p.surchargeAmount)}
                        </span>
                      )}
                      {p.discountAmount > 0 && (
                        <span className="ml-1 text-orange-600">
                          · discount: -{formatCurrency(p.discountAmount)}
                        </span>
                      )}
                    </p>
                    {line.matrixFailed && (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        Couldn’t load this service’s pricing options, so only its catalogue price is
                        shown. Remove it and add it again to retry.
                      </p>
                    )}
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
                          aria-label={`Quantity of ${line.name}`}
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
                          onChange={(e) => setLine(line.key, { discountReason: e.target.value })}
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
    </div>
  )
}
