import { cedisToCents } from '@denel/utils'
import { Grid3x3, Info, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type ApplicationScope,
  getServiceMatrix,
  getToothClasses,
  setServiceMatrix,
  type ToothClass,
  updateService,
} from '@/lib/actions/services'
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
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'
import { formatAmount } from '@/shared/utils/currency'

interface Props {
  serviceId: string
  isAdmin: boolean
  onDirtyChange?: (dirty: boolean) => void
}

interface CellRow {
  variantName: string
  toothClassId: string // '' = Any (class-agnostic)
  price: string
}

const ANY_CLASS = '__any__'

const emptyCell = (): CellRow => ({
  variantName: '',
  toothClassId: '',
  price: '',
})

// Base price and cell prices are stored as integer pesewas (cents); the shared
// formatter divides. A local `Intl.NumberFormat(...).format(raw)` here printed
// every price 100x too large.
const ghs = (cents: number) => `GHS ${formatAmount(cents)}`

/** Seed a cedis text input from a stored pesewa (cents) value — plain decimal so
 *  `Number()` round-trips it. Re-crossed on save via `cedisToCents`. */
const centsToCedisInput = (cents: number): string => String(cents / 100)

/**
 * Price-matrix step (build plan R2). Variants are only offered when the service's
 * application type supports them (scope.variantType: 'plain' → variants without a
 * tooth class; 'tooth_class' → variants can carry a class; 'none' → no variants).
 * A "Variants available" toggle turns the variant editor on/off.
 */
export function ServicePricingMatrix({ serviceId, isAdmin, onDirtyChange }: Props) {
  const [loadedScope, setLoadedScope] = useState<ApplicationScope | null>(null)
  const [serviceCode, setServiceCode] = useState<string | null>(null)
  const [baseAmount, setBaseAmount] = useState<number>(0)

  const [variantsEnabled, setVariantsEnabled] = useState(false)
  const [cells, setCells] = useState<CellRow[]>([])

  const [snapshot, setSnapshot] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const toothClassesQuery = useApiQuery<ToothClass[]>(queryKeys.services.toothClasses(), () =>
    getToothClasses()
  )
  const classes = toothClassesQuery.data ?? []

  const matrixQuery = useApiQuery(queryKeys.services.matrix(serviceId), () =>
    getServiceMatrix(serviceId)
  )

  const loading = toothClassesQuery.isLoading || matrixQuery.isLoading

  useEffect(() => {
    if (toothClassesQuery.isError || matrixQuery.isError) {
      toast.error('Failed to load pricing matrix')
    }
  }, [toothClassesQuery.isError, matrixQuery.isError])

  // Re-seed the draft fields whenever the server matrix actually changes —
  // initial load, or after a successful save's refetch. Structural sharing
  // keeps `matrixQuery.data` the same reference across a no-op background
  // refetch, so this doesn't clobber an in-progress edit.
  useEffect(() => {
    const mx = matrixQuery.data
    if (!mx) return
    const svc = mx.service
    setLoadedScope(mx.scope ?? null)
    setServiceCode((svc.serviceCode as string | null) ?? null)
    setBaseAmount(Number(svc.amount) || 0)
    setVariantsEnabled(Boolean(svc.variantsEnabled) && mx.cells.length >= 0)
    setCells(
      mx.cells.map((c) => ({
        variantName: c.variantName ?? '',
        toothClassId: c.toothClassId ?? '',
        price: centsToCedisInput(c.price ?? 0),
      }))
    )
  }, [matrixQuery.data])

  useEffect(() => {
    if (!loading && snapshot === '') {
      setSnapshot(JSON.stringify({ variantsEnabled, cells }))
    }
  }, [loading, snapshot, variantsEnabled, cells])

  const current = JSON.stringify({ variantsEnabled, cells })
  const dirty = snapshot !== '' && current !== snapshot

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const variantType = loadedScope?.variantType ?? 'none'
  const showVariants = variantType !== 'none'
  const showClass = variantType === 'tooth_class'

  const setCell = useCallback((idx: number, patch: Partial<CellRow>) => {
    setCells((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }, [])

  function toggleVariants(on: boolean) {
    setVariantsEnabled(on)
    if (on && cells.length === 0) setCells([emptyCell()])
  }

  async function handleSave() {
    if (!isAdmin) {
      toast.error('Only admins can change pricing.')
      return
    }
    const activeCells = variantsEnabled ? cells : []
    for (const [i, c] of activeCells.entries()) {
      if (!c.variantName.trim()) {
        toast.error(`Variant ${i + 1}: enter a name`)
        return
      }
      const p = Number(c.price)
      if (c.price.trim() === '' || Number.isNaN(p) || p < 0) {
        toast.error(`Variant ${i + 1}: enter a price`)
        return
      }
    }

    setSaving(true)
    try {
      const svcRes = await updateService(serviceId, { variantsEnabled })
      if (!svcRes.success) {
        toast.error(svcRes.error || 'Failed to save')
        setSaving(false)
        return
      }
      const cellRes = await setServiceMatrix(
        serviceId,
        activeCells.map((c, i) => ({
          variantName: c.variantName.trim() || null,
          toothClassId: showClass && c.toothClassId ? c.toothClassId : null,
          // Inputs are cedis; the matrix column is integer pesewas (cents).
          // Convert here — this is the write boundary.
          price: cedisToCents(Number(c.price)),
          sortOrder: i,
        }))
      )
      setSaving(false)
      if (!cellRes.success) {
        toast.error(cellRes.error || 'Failed to save variants')
        return
      }
      setSnapshot(current)
      matrixQuery.refetch()
      toast.success('Pricing saved')
    } catch {
      setSaving(false)
      toast.error('Failed to save pricing')
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          <Grid3x3 className="h-4 w-4" />
          Price matrix
        </Label>
        {serviceCode && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {serviceCode}
          </span>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-[2px] h-3 w-3 shrink-0" />
        Application type: <strong className="mx-1">{loadedScope?.displayName ?? 'Flat'}</strong> ·
        base price {ghs(baseAmount)}.
      </p>

      {!showVariants ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          This application type doesn't use variants — the service bills at its base price (set in
          Details).
        </div>
      ) : (
        <>
          <label className="flex cursor-pointer items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Variants available</p>
              <p className="text-xs text-muted-foreground">
                {showClass
                  ? 'Add variants (e.g. Simple/Surgical), each priced — optionally per tooth class.'
                  : 'Add named variants (e.g. sizes) each with its own price.'}
              </p>
            </div>
            <Switch
              checked={variantsEnabled}
              onCheckedChange={toggleVariants}
              disabled={!isAdmin}
            />
          </label>

          {variantsEnabled && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Variants</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCells((p) => [...p, emptyCell()])}
                  disabled={!isAdmin}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add variant
                </Button>
              </div>

              {cells.map((cell, idx) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                  key={idx}
                  className="grid grid-cols-1 items-center gap-2 rounded-md border p-2 sm:grid-cols-[1fr_auto]"
                >
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Input
                      placeholder="Variant name"
                      value={cell.variantName}
                      onChange={(e) => setCell(idx, { variantName: e.target.value })}
                      disabled={!isAdmin}
                      className="h-9"
                    />
                    {showClass && (
                      <Select
                        value={cell.toothClassId || ANY_CLASS}
                        onValueChange={(v) =>
                          setCell(idx, { toothClassId: v === ANY_CLASS ? '' : v })
                        }
                        disabled={!isAdmin}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ANY_CLASS}>Any class</SelectItem>
                          {classes.map((tc) => (
                            <SelectItem key={tc.id} value={tc.id}>
                              {tc.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="price"
                      value={cell.price}
                      onChange={(e) => setCell(idx, { price: e.target.value })}
                      disabled={!isAdmin}
                      className={`h-9 ${showClass ? '' : 'col-span-2'}`}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 justify-self-end"
                    onClick={() => setCells((p) => p.filter((_, i) => i !== idx))}
                    disabled={!isAdmin}
                    aria-label="Remove variant"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {isAdmin && (
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            variant={dirty ? 'default' : 'outline'}
          >
            {saving ? 'Saving…' : dirty ? 'Save pricing' : 'Saved'}
          </Button>
        </div>
      )}
    </div>
  )
}
