import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getServiceDoctors, getServices } from '@/lib/actions/services'
import { listSpecialistDirectory, type SpecialistDirectoryEntry } from '@/lib/actions/specialists'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/components/ui/command'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { centsToInput, formatAmount, inputToCents } from '@/shared/utils/currency'

// ── Public types ─────────────────────────────────────────────────────────────

export type PlanLineDiscountType = 'none' | 'percent' | 'amount'

export interface PlanLine {
  /** Stable client-side key — the row id, not the service id. */
  key: string
  serviceId: string | null
  /** Pulled from services.treatment_type_id when the service is clinic-category. */
  treatmentTypeId: string | null
  description: string
  quantity: number
  unitPrice: number
  discountType: PlanLineDiscountType
  discountValue: number
  doctorId: string | null
  /** null = use the doctor's default at billing time (or 0 for internal). */
  commissionRate: number | null
  /**
   * What the line was billed at on the estimate it came from (its `lineTotal`), when it came from
   * one. Such a line is not priced again here: unit price × quantity would drop its surcharge, its
   * discount, its tax and a first-unit / additional-unit step, and disagree with the invoice.
   */
  billedTotal?: number
}

export interface PlanLineTotals {
  subtotal: number
  discountTotal: number
  total: number
}

interface Props {
  value: PlanLine[]
  onChange: (next: PlanLine[]) => void
  disabled?: boolean
  /** Show the per-row commission footer. Default false so the patient-facing
   *  plan dialog doesn't leak rate intel; flip to true on the admin Services
   *  page or commission-tracking surfaces. */
  showCommissionFootnote?: boolean
  /**
   * Amount already settled against the invoice this plan bills (a deposit taken
   * at confirm time). When set, the summary splits the treatment total from the
   * amount the installments actually cover — otherwise the footer advertises the
   * gross while the schedule is built on the balance, and the two disagree.
   */
  alreadyPaid?: number
}

// ── Internal types ───────────────────────────────────────────────────────────

interface ServiceRow {
  id: string
  category: 'clinic' | 'xray' | 'lab' | 'insurance'
  name: string
  amount: number
  treatmentTypeId: string | null
  isActive: boolean
  status: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  return `GHS ${formatAmount(n)}`
}

function computeLineTotal(line: PlanLine): {
  subtotal: number
  discount: number
  total: number
} {
  if (line.billedTotal != null) {
    return { subtotal: line.billedTotal, discount: 0, total: line.billedTotal }
  }
  const subtotal = line.quantity * line.unitPrice
  let discount = 0
  if (line.discountType === 'percent') discount = Math.round((subtotal * line.discountValue) / 100)
  else if (line.discountType === 'amount') discount = line.discountValue
  // Clamp: 0 ≤ discount ≤ subtotal. A negative discountValue (the amount field
  // is a free-text money input) would otherwise INFLATE the line total here
  // while the backend silently drops it (payment-plan-service rejects
  // discountValue ≤ 0) — the reviewed plan and the created plan would disagree.
  discount = Math.max(0, Math.min(discount, subtotal))
  return { subtotal, discount, total: subtotal - discount }
}

export function computePlanTotals(lines: PlanLine[]): PlanLineTotals {
  let subtotal = 0
  let discountTotal = 0
  for (const l of lines) {
    const { subtotal: s, discount: d } = computeLineTotal(l)
    subtotal += s
    discountTotal += d
  }
  return { subtotal, discountTotal, total: subtotal - discountTotal }
}

export function makeEmptyLine(): PlanLine {
  return {
    key: `line_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    serviceId: null,
    treatmentTypeId: null,
    description: '',
    quantity: 1,
    unitPrice: 0,
    discountType: 'none',
    discountValue: 0,
    doctorId: null,
    commissionRate: null,
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function PlanLineItemsEditor({
  value,
  onChange,
  disabled,
  alreadyPaid = 0,
  showCommissionFootnote = false,
}: Props) {
  /** serviceId → cached doctor links, fetched lazily on first service pick. */
  const [serviceDoctorsCache, setServiceDoctorsCache] = useState<
    Map<
      string,
      Array<{
        doctorId: string
        commissionRate: number | null
        noCommission: boolean
        specialistType: 'internal' | 'external'
        defaultCommissionRate: number
      }>
    >
  >(new Map())

  // activeOnly = isActive AND approved; `status` alone is the approval column.
  const servicesQuery = useApiQuery<ServiceRow[]>(
    queryKeys.services.list({ activeOnly: true }),
    () => getServices({ activeOnly: true })
  )
  const services = useMemo(
    () => (servicesQuery.data ?? []).filter((s) => s.isActive),
    [servicesQuery.data]
  )

  // Same key literal petty-ref-picker.tsx uses for the same directory read.
  const specialistsQuery = useApiQuery<SpecialistDirectoryEntry[]>(
    ['specialists', 'directory'] as const,
    () => listSpecialistDirectory()
  )
  const specialists = specialistsQuery.data ?? []

  const loading = servicesQuery.isLoading || specialistsQuery.isLoading

  const specialistById = useMemo(() => {
    const m = new Map<string, SpecialistDirectoryEntry>()
    for (const s of specialists) m.set(s.id, s)
    return m
  }, [specialists])

  const fetchServiceDoctors = useCallback(
    async (serviceId: string) => {
      if (serviceDoctorsCache.has(serviceId)) return serviceDoctorsCache.get(serviceId)!
      const res = await getServiceDoctors(serviceId)
      const rows =
        res.success && res.data
          ? res.data.map((d) => ({
              doctorId: d.doctorId,
              commissionRate: d.commissionRate,
              noCommission: d.noCommission,
              specialistType: d.specialistType,
              defaultCommissionRate: d.defaultCommissionRate,
            }))
          : []
      setServiceDoctorsCache((prev) => new Map(prev).set(serviceId, rows))
      return rows
    },
    [serviceDoctorsCache]
  )

  function patchLine(key: string, patch: Partial<PlanLine>) {
    onChange(value.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeLine(key: string) {
    onChange(value.filter((l) => l.key !== key))
  }

  function addLine() {
    onChange([...value, makeEmptyLine()])
  }

  async function handlePickService(lineKey: string, service: ServiceRow) {
    // Patch the line: description + unitPrice from the service, treatmentTypeId
    // for downstream auto-fill, doctor auto-pick if exactly one link exists.
    const links = await fetchServiceDoctors(service.id)
    const onlyLink = links.length === 1 ? links[0] : null
    const onlyDoctor = onlyLink ? (specialistById.get(onlyLink.doctorId) ?? null) : null

    const next: Partial<PlanLine> = {
      serviceId: service.id,
      treatmentTypeId: service.treatmentTypeId,
      description: service.name,
      unitPrice: service.amount,
      doctorId: onlyDoctor?.id ?? null,
      commissionRate: null,
    }

    if (onlyLink && onlyDoctor) {
      next.commissionRate = onlyLink.noCommission
        ? 0
        : (onlyLink.commissionRate ?? onlyDoctor.defaultCommissionRate)
    }

    patchLine(lineKey, next)
  }

  async function handlePickDoctor(line: PlanLine, doctorId: string) {
    const sp = specialistById.get(doctorId)
    if (!sp) return
    if (sp.specialistType === 'internal') {
      patchLine(line.key, { doctorId, commissionRate: 0 })
      return
    }
    // External — try service_doctors link first; fall back to default.
    let rate: number = sp.defaultCommissionRate
    if (line.serviceId) {
      const links = await fetchServiceDoctors(line.serviceId)
      const link = links.find((l) => l.doctorId === doctorId)
      if (link) rate = link.noCommission ? 0 : (link.commissionRate ?? sp.defaultCommissionRate)
    }
    patchLine(line.key, { doctorId, commissionRate: rate })
  }

  const totals = useMemo(() => computePlanTotals(value), [value])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Treatments</Label>
        <Button variant="outline" size="sm" onClick={addLine} disabled={disabled}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add treatment
        </Button>
      </div>

      {loading ? (
        <div className="rounded-md border p-4 text-sm text-muted-foreground">Loading catalog…</div>
      ) : value.length === 0 ? (
        <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
          No treatments yet. Click "Add treatment" to start composing the plan.
        </div>
      ) : (
        <div className="space-y-2">
          {value.map((line) => (
            <LineRow
              key={line.key}
              line={line}
              services={services}
              specialists={specialists}
              specialistById={specialistById}
              onPickService={(svc) => handlePickService(line.key, svc)}
              onPickDoctor={(id) => handlePickDoctor(line, id)}
              onPatch={(patch) => patchLine(line.key, patch)}
              onRemove={() => removeLine(line.key)}
              disabled={disabled}
              showCommissionFootnote={showCommissionFootnote}
            />
          ))}
        </div>
      )}

      {value.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-mono">{fmtMoney(totals.subtotal)}</span>
          </div>
          {totals.discountTotal > 0 && (
            <div className="flex items-center justify-between text-emerald-700">
              <span>− Discount</span>
              <span className="font-mono">{fmtMoney(totals.discountTotal)}</span>
            </div>
          )}
          <div className="mt-1 flex items-center justify-between border-t pt-1">
            <span className="font-medium">
              {alreadyPaid > 0 ? 'Treatment total' : 'Plan total'}
            </span>
            <span className="font-mono font-semibold">{fmtMoney(totals.total)}</span>
          </div>
          {alreadyPaid > 0 && (
            <>
              <div className="flex items-center justify-between text-emerald-700">
                <span>− Already paid</span>
                <span className="font-mono">{fmtMoney(alreadyPaid)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t pt-1">
                <span className="font-medium">Scheduled over installments</span>
                <span className="font-mono font-semibold">
                  {fmtMoney(Math.max(0, totals.total - alreadyPaid))}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Per-row component ────────────────────────────────────────────────────────

interface MoneyCellInputProps {
  cents: number
  onChangeCents: (nextCents: number) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
}

function MoneyCellInput({
  cents,
  onChangeCents,
  disabled,
  placeholder = '0.00',
  className,
  'aria-label': ariaLabel,
}: MoneyCellInputProps) {
  const [text, setText] = useState(() => centsToInput(cents))
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    if (!isFocused) {
      setText(centsToInput(cents))
    }
  }, [cents, isFocused])

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={isFocused ? text : centsToInput(cents)}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
      onFocus={() => {
        setIsFocused(true)
        setText(cents > 0 ? (cents / 100).toString() : '')
      }}
      onChange={(e) => {
        setText(e.target.value)
        onChangeCents(inputToCents(e.target.value))
      }}
      onBlur={() => {
        setIsFocused(false)
        setText(centsToInput(cents))
      }}
    />
  )
}

interface LineRowProps {
  line: PlanLine
  services: ServiceRow[]
  specialists: SpecialistDirectoryEntry[]
  specialistById: Map<string, SpecialistDirectoryEntry>
  onPickService: (svc: ServiceRow) => void
  onPickDoctor: (doctorId: string) => void
  onPatch: (patch: Partial<PlanLine>) => void
  onRemove: () => void
  disabled?: boolean
  showCommissionFootnote?: boolean
}

function LineRow({
  line,
  services,
  specialists,
  specialistById,
  onPickService,
  onPickDoctor,
  onPatch,
  onRemove,
  disabled,
  showCommissionFootnote = false,
}: LineRowProps) {
  const [comboOpen, setComboOpen] = useState(false)
  const selectedService = line.serviceId ? services.find((s) => s.id === line.serviceId) : null

  const doctor = line.doctorId ? specialistById.get(line.doctorId) : null
  const isInternalDoctor = doctor?.specialistType === 'internal'
  const { subtotal, discount, total } = useMemo(() => computeLineTotal(line), [line])

  return (
    <div className="rounded-md border p-3 space-y-2 bg-card">
      {/* Row 1: Service combobox + qty + unit price */}
      <div className="grid grid-cols-[1fr_60px_110px_auto] gap-2 items-center">
        <Popover open={comboOpen} onOpenChange={setComboOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={comboOpen}
              className="h-9 justify-between font-normal"
              disabled={disabled}
            >
              <span className="truncate">
                {selectedService
                  ? selectedService.name
                  : line.description || (
                      <span className="text-muted-foreground">Select a service…</span>
                    )}
              </span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
            <Command>
              <CommandInput placeholder="Search services…" />
              <CommandList>
                <CommandEmpty>No service matches.</CommandEmpty>
                <CommandGroup>
                  {services.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={`${s.name} ${s.category}`}
                      onSelect={() => {
                        onPickService(s)
                        setComboOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          line.serviceId === s.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="flex-1">{s.name}</span>
                      <Badge variant="outline" className="ml-2 text-[10px] capitalize">
                        {s.category}
                      </Badge>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {fmtMoney(s.amount)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Input
          type="number"
          min="1"
          step="1"
          value={line.quantity}
          onChange={(e) => onPatch({ quantity: Math.max(1, Number(e.target.value) || 1) })}
          className="h-9 text-right"
          disabled={disabled}
          aria-label="Quantity"
        />
        <MoneyCellInput
          cents={line.unitPrice}
          onChangeCents={(unitPrice) => onPatch({ unitPrice })}
          className="h-9 text-right font-mono"
          disabled={disabled}
          aria-label="Unit price"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          className="h-9 w-9"
          aria-label="Remove line"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {/* Row 2: Doctor + Discount + Line total */}
      <div className="grid grid-cols-[1fr_180px_140px] gap-2 items-center">
        <Select
          value={line.doctorId ?? '__none'}
          onValueChange={(v) =>
            v === '__none' ? onPatch({ doctorId: null, commissionRate: null }) : onPickDoctor(v)
          }
          disabled={disabled}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Assign doctor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">— No doctor —</SelectItem>
            {specialists.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No active doctors available.
              </div>
            )}
            {specialists.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
                <span className="ml-1 text-[10px] text-muted-foreground">({s.specialistType})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Discount
          </span>
          <div className="flex items-center gap-1">
            <Select
              value={line.discountType}
              onValueChange={(v) =>
                onPatch({ discountType: v as PlanLineDiscountType, discountValue: 0 })
              }
              disabled={disabled}
            >
              <SelectTrigger className="h-9 w-[64px] px-2" aria-label="Discount type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="amount">₵</SelectItem>
                <SelectItem value="percent">%</SelectItem>
              </SelectContent>
            </Select>
            {line.discountType === 'amount' ? (
              <MoneyCellInput
                cents={line.discountValue}
                // Clamp negatives at the boundary — the percent input below
                // already does (Math.max(0, …)); the amount field must match.
                onChangeCents={(discountValue) =>
                  onPatch({ discountValue: Math.max(0, discountValue) })
                }
                className="h-9 text-right font-mono"
                disabled={disabled}
                aria-label="Discount amount"
              />
            ) : (
              <Input
                type="number"
                min="0"
                max={100}
                step="0.1"
                value={line.discountValue || ''}
                placeholder="0"
                onChange={(e) =>
                  onPatch({
                    discountValue: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                  })
                }
                className="h-9 text-right font-mono"
                disabled={disabled || line.discountType === 'none'}
                aria-label="Discount percentage"
              />
            )}
          </div>
        </div>

        <div className="text-right">
          <div className="font-mono text-sm font-semibold">{fmtMoney(total)}</div>
          {discount > 0 && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {fmtMoney(subtotal)} − {fmtMoney(discount)}
            </div>
          )}
        </div>
      </div>

      {showCommissionFootnote && line.doctorId && (
        <div className="flex items-center justify-end text-[11px] text-muted-foreground">
          {isInternalDoctor ? (
            <span>Internal doctor — no commission</span>
          ) : line.commissionRate != null ? (
            <span>
              Commission: {line.commissionRate}% ={' '}
              <span className="font-mono">{fmtMoney((total * line.commissionRate) / 100)}</span>
            </span>
          ) : (
            <span>Commission: use doctor's default at billing time</span>
          )}
        </div>
      )}
    </div>
  )
}
