import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { LowStockItem } from '@/features/dashboard/types'
import { addRestockDraft } from '@/lib/actions/reports'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useInventoryLocations } from '@/shared/hooks/use-inventory-locations'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

interface RestockSheetProps {
  item: LowStockItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function RestockSheet({ item, open, onOpenChange, onSuccess }: RestockSheetProps) {
  const [addQty, setAddQty] = useState('')
  const [location, setLocation] = useState('')
  const { locations: locationsList, error: locationsError } = useInventoryLocations({
    enabled: open && item?.type === 'inventory',
  })
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const isDirty = addQty !== '' || location !== ''
  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  useEffect(() => {
    if (!open || !item) return
    setAddQty('')
    setLocation('')
    setStatusMessage(undefined)
  }, [open, item])

  useEffect(() => {
    if (locationsError) toast.error('Could not load storage locations')
  }, [locationsError])

  function handleSubmit() {
    if (!item) return
    setStatusMessage(undefined)
    const qty = parseInt(addQty, 10)
    if (Number.isNaN(qty) || qty <= 0) {
      toast.error('Please enter a valid quantity to add')
      return
    }
    void submit(async () => {
      const inventoryType: 'inventory' | 'product' =
        item.type === 'product' ? 'product' : 'inventory'
      const result = await addRestockDraft({
        // 🔴 fix: product IDs must not be sent as inventoryId (FK references inventory only)
        inventoryId: inventoryType === 'inventory' ? item.id : null,
        inventoryType,
        name: item.name,
        quantityAdded: qty,
        location: inventoryType === 'inventory' ? location || null : null,
      })
      if (result.success) {
        toast.success("Restock added to today's report (pending submission)")
        onOpenChange(false)
        onSuccess()
      } else {
        const msg = typeof result.error === 'string' ? result.error : 'Failed to record restock'
        setStatusMessage(msg)
        surfaceApiError(result, 'Failed to record restock')
      }
    })
  }

  if (!item) return null

  const parsedQty = parseInt(addQty, 10)
  // Require a strict positive integer — block fractional values like "50.7"
  const isValidQty = /^\d+$/.test(addQty.trim()) && parsedQty > 0
  const newTotal = isValidQty ? item.stockQuantity + parsedQty : null

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Record Restock"
        description={`Add ${item.name} to today's report. Applied to stock at end-of-day submission.`}
        size="sm"
        submitLabel="Add to today's report"
        submitting={isSubmitting}
        submitDisabled={!isValidQty}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="space-y-4">
          {/* Current stock summary */}
          <div className="rounded-md border bg-muted/50 px-4 py-3 space-y-1">
            <p className="text-sm font-medium">{item.name}</p>
            <p className="text-xs text-muted-foreground">
              Current stock:{' '}
              <span
                className={
                  item.stockQuantity === 0
                    ? 'text-red-600 font-semibold'
                    : 'text-orange-600 font-semibold'
                }
              >
                {item.stockQuantity} {item.unit || 'units'}
              </span>
              {item.reorderLevel != null && <span> · Min: {item.reorderLevel}</span>}
            </p>
          </div>

          {/* Quantity to add */}
          <div className="space-y-2">
            <Label htmlFor="restock-add-qty">Quantity to add</Label>
            <Input
              id="restock-add-qty"
              type="number"
              min="1"
              placeholder="e.g. 50"
              value={addQty}
              onChange={(e) => {
                // Allow only whole-number digits (block floats like "50.7")
                const v = e.target.value
                if (v === '' || /^\d+$/.test(v)) setAddQty(v)
              }}
              autoFocus
            />
            {newTotal !== null && (
              <p className="text-xs text-muted-foreground">
                New total:{' '}
                <span className="font-medium text-foreground">
                  {newTotal} {item.unit || 'units'}
                </span>
              </p>
            )}
          </div>

          {/* Storage location — inventory items only */}
          {item.type === 'inventory' && (
            <div className="space-y-2">
              <Label htmlFor="restock-location">Storage location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger id="restock-location">
                  <SelectValue placeholder="Select a storage location" />
                </SelectTrigger>
                <SelectContent>
                  {locationsList.map((l) => (
                    <SelectItem key={l.id} value={l.name}>
                      {l.name}
                      {l.code ? ` (${l.code})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
