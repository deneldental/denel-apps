import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { validateAdjustment } from '@/features/inventory/policies'
import { useInventoryPolicies } from '@/features/inventory/use-inventory-policies'
import { adjustInventoryStock } from '@/lib/actions/inventory'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useInventoryLocations } from '@/shared/hooks/use-inventory-locations'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

const OTHER_REASON = '__other__'
const NO_LOCATION = '__none__'

interface AdjustStockSheetProps {
  product: { id: string; name: string; stockQuantity: number; unit?: string | null }
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful adjustment — refetch the item / list. */
  onSaved?: () => void
}

/**
 * The one way to change a stock quantity (settings-domain-audit S5-B): a new
 * count or a signed difference, a reason from Settings → Inventory → Store
 * Policies (or "Other" with a note), recorded as a stock movement.
 */
export function AdjustStockSheet({ product, open, onOpenChange, onSaved }: AdjustStockSheetProps) {
  const { isSubmitting, submit } = useSubmitGuard()
  const { policies } = useInventoryPolicies({ enabled: open })
  const { locations } = useInventoryLocations({ enabled: open })

  const [mode, setMode] = useState<'set' | 'delta'>('set')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [otherReason, setOtherReason] = useState('')
  const [note, setNote] = useState('')
  const [locationId, setLocationId] = useState(NO_LOCATION)
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const reasonText = reason === OTHER_REASON ? otherReason : reason
  const { delta, resulting, problem } = useMemo(
    () =>
      validateAdjustment({ mode, quantity, current: product.stockQuantity, reason: reasonText }),
    [mode, quantity, product.stockQuantity, reasonText]
  )

  const isDirty =
    quantity !== '' ||
    reason !== '' ||
    otherReason !== '' ||
    note !== '' ||
    locationId !== NO_LOCATION

  function resetForm() {
    setMode('set')
    setQuantity('')
    setReason('')
    setOtherReason('')
    setNote('')
    setLocationId(NO_LOCATION)
    setStatusMessage(undefined)
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => {
      onOpenChange(false)
      resetForm()
    },
  })

  async function handleSubmit() {
    if (problem || delta === null) {
      setStatusMessage(problem ?? 'Enter a quantity')
      return
    }
    await submit(async () => {
      try {
        const result = await adjustInventoryStock(product.id, {
          mode,
          quantity: Number(quantity.trim()),
          reason: reasonText.trim(),
          note: note.trim() || undefined,
          locationId: locationId === NO_LOCATION ? null : locationId,
        })
        toast.success(
          `${product.name}: stock ${result.delta > 0 ? 'increased' : 'reduced'} to ${result.stockQuantity}`
        )
        onOpenChange(false)
        resetForm()
        onSaved?.()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to adjust stock'
        setStatusMessage(message)
        surfaceApiError({ error: message })
      }
    })
  }

  const unitLabel = product.unit ? ` ${product.unit}` : ''

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Adjust stock"
        description={`${product.name} — currently ${product.stockQuantity}${unitLabel}. Every adjustment is recorded with its reason.`}
        size="sm"
        submitLabel="Record adjustment"
        submitting={isSubmitting}
        submitDisabled={problem !== null}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-6">
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v === 'delta' ? 'delta' : 'set')}
            className="grid grid-cols-2 gap-3"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="set" id="adjust-mode-set" />
              <Label htmlFor="adjust-mode-set">New count</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="delta" id="adjust-mode-delta" />
              <Label htmlFor="adjust-mode-delta">Add or remove</Label>
            </div>
          </RadioGroup>

          <div className="space-y-2">
            <Label htmlFor="adjust-quantity">{mode === 'set' ? 'New count' : 'Difference'}</Label>
            <Input
              id="adjust-quantity"
              type="number"
              step="1"
              min={mode === 'set' ? 0 : undefined}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={mode === 'set' ? String(product.stockQuantity) : 'e.g. -3 or 5'}
            />
            {quantity.trim() !== '' && problem && problem !== 'Choose a reason' ? (
              <p className="text-xs text-destructive">{problem}</p>
            ) : resulting !== null ? (
              <p className="text-xs text-muted-foreground">
                Result: {product.stockQuantity} → {resulting}
                {unitLabel}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {mode === 'set'
                  ? 'The physical count you found.'
                  : 'Negative removes stock, positive adds it.'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="adjust-reason">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {policies.adjustmentReasons.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER_REASON}>Other…</SelectItem>
              </SelectContent>
            </Select>
            {reason === OTHER_REASON && (
              <Input
                aria-label="Other reason"
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                placeholder="Describe the reason"
                maxLength={120}
              />
            )}
          </div>

          {locations.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="adjust-location">Location (optional)</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="adjust-location">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LOCATION}>No location</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                      {loc.code ? ` (${loc.code})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="adjust-note">Note (optional)</Label>
            <Textarea
              id="adjust-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Anything the audit trail should know"
            />
          </div>
        </div>
      </SheetFormLayout>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
