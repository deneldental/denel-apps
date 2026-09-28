import { Check, Plus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getServices, lookupServicePrice } from '@/lib/actions/services'
import { getTreatmentTypes } from '@/lib/actions/treatment-types'
import type { treatmentTypes } from '@/lib/db/schema'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { formatCurrency } from '@/shared/utils/currency'

type TreatmentType = typeof treatmentTypes.$inferSelect

export interface TreatmentPaymentItem {
  treatmentId: string
  name: string
  amount: number
}

interface TreatmentPaymentInputProps {
  value: TreatmentPaymentItem[]
  onChange: (value: TreatmentPaymentItem[]) => void
  disabled?: boolean
  maxTotalAmount?: number
  /** When set (insurer selected on the payment), treatment prices auto-fill from
   *  that insurer's effective CSV price list, and a note shows if a treatment
   *  isn't covered by the insurer. */
  insuranceCompanyId?: string
  /**
   * Fires after each insurer price lookup resolves, so a caller can split
   * covered from uncovered lines. Keyed by treatment id (not row index, which
   * shifts when a row above is removed).
   */
  onPriceResolved?: (
    treatmentId: string,
    info: { covered: boolean; insurerPrice: number; clinicPrice: number }
  ) => void
}

export function TreatmentPaymentInput({
  value,
  onChange,
  disabled = false,
  maxTotalAmount,
  insuranceCompanyId,
  onPriceResolved,
}: TreatmentPaymentInputProps) {
  // treatmentId → false when the treatment isn't in the insurer's approved list.
  // Keyed by id rather than row index: removing a row used to shift every index
  // below it, so the "not covered" note would stick to the wrong treatment.
  const [coverage, setCoverage] = useState<Record<string, boolean>>({})

  const servicesQuery = useApiQuery<any[]>(queryKeys.services.list({ activeOnly: true }), () =>
    getServices({ activeOnly: true })
  )
  const treatmentTypesList = useMemo(
    () => (servicesQuery.data ?? []).filter((s: any) => s.category !== 'insurance'),
    [servicesQuery.data]
  )

  const handleAddTreatment = () => {
    onChange([...value, { treatmentId: '', name: '', amount: 0 }])
  }

  const handleRemoveTreatment = (index: number) => {
    const newTreatments = [...value]
    newTreatments.splice(index, 1)
    onChange(newTreatments)
  }

  const handleUpdateTreatment = async (index: number, updates: Partial<TreatmentPaymentItem>) => {
    const newTreatments = [...value]
    newTreatments[index] = { ...newTreatments[index], ...updates }
    onChange(newTreatments)

    // Auto-fill amount from the catalog (or the insurer's price when an insurer
    // is selected) whenever a treatment is newly picked.
    if (updates.treatmentId && updates.treatmentId !== value[index]?.treatmentId) {
      const treatmentId = updates.treatmentId
      try {
        const result = await lookupServicePrice({
          serviceId: treatmentId,
          insuranceCompanyId,
        })
        if (result.success && result.data) {
          const covered = result.data.insurerCovered !== false
          // On an insurer lookup `amount` is the insurer's rate and
          // `clinicPrice` is ours; without an insurer they're the same number.
          const clinicPrice = result.data.clinicPrice ?? result.data.amount
          const filled = [...newTreatments]
          filled[index] = { ...filled[index], amount: result.data.amount }
          onChange(filled)
          setCoverage((prev) => ({ ...prev, [treatmentId]: covered }))
          onPriceResolved?.(treatmentId, {
            covered,
            insurerPrice: covered ? result.data.amount : 0,
            clinicPrice,
          })
        }
      } catch {
        // Silently ignore — price lookup is optional, user can type manually.
      }
    }
  }

  const availableTreatments = useMemo(() => {
    const selectedIds = value.map((t) => t.treatmentId).filter(Boolean)
    return treatmentTypesList.filter((t) => !selectedIds.includes(t.id))
  }, [treatmentTypesList, value])

  const totalAmount = value.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)

  return (
    <div className="space-y-4">
      {value.map((item, index) => (
        <div key={index} className="space-y-1">
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <TreatmentSelect
                value={item.treatmentId}
                onChange={(treatmentId, name) =>
                  handleUpdateTreatment(index, { treatmentId, name })
                }
                treatments={treatmentTypesList}
                disabled={disabled}
              />
            </div>
            <div className="w-[120px] relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">GHS</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={item.amount !== undefined && item.amount !== 0 ? item.amount / 100 : ''}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  handleUpdateTreatment(index, {
                    amount: Number.isNaN(val) ? 0 : Math.round(val * 100),
                  })
                }}
                className="pl-12"
                placeholder="0.00"
                disabled={disabled}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleRemoveTreatment(index)}
              disabled={disabled}
              className="shrink-0"
              aria-label="Remove"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {insuranceCompanyId && item.treatmentId && coverage[item.treatmentId] === false && (
            <p className="pl-1 text-xs text-amber-600">
              Not in this insurer's price list — charged as self-pay, not billable to the insurer.
            </p>
          )}
        </div>
      ))}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddTreatment}
          disabled={disabled || availableTreatments.length === 0}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Treatment
        </Button>

        <div className="text-sm font-medium">
          Total:{' '}
          <span
            className={cn(
              maxTotalAmount && totalAmount > maxTotalAmount ? 'text-destructive' : 'text-primary'
            )}
          >
            {formatCurrency(totalAmount)}
          </span>
          {maxTotalAmount && totalAmount > maxTotalAmount && (
            <span className="text-destructive ml-2 font-normal text-xs block text-right mt-1">
              Exceeds outstanding balance
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function TreatmentSelect({
  value,
  onChange,
  treatments,
  disabled,
}: {
  value: string
  onChange: (id: string, name: string) => void
  treatments: TreatmentType[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  const selectedTreatment = treatments.find((t) => t.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          <span className="truncate">
            {selectedTreatment
              ? selectedTreatment.displayName || selectedTreatment.name
              : 'Select treatment...'}
          </span>
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search treatment..." />
          <CommandList>
            <CommandEmpty>No treatment found.</CommandEmpty>
            <CommandGroup>
              {treatments.map((treatment) => (
                <CommandItem
                  key={treatment.id}
                  value={treatment.displayName || treatment.name}
                  onSelect={() => {
                    onChange(treatment.id, treatment.displayName || treatment.name)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === treatment.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {treatment.displayName || treatment.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
