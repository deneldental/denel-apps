import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Product } from '@/features/inventory/pages/columns'
import { SingleImageUpload } from '@/features/products/components/single-image-upload'
import { updateInventoryItem } from '@/lib/actions/inventory'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { ExpiryDateField, toExpiryInput } from '@/shared/components/expiry-date-field'
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
import { useLookup } from '@/shared/hooks/use-lookup'
import { useSeedOnOpen } from '@/shared/hooks/use-seed-on-open'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { parseLocalDate } from '@/shared/lib/dates'
import { isSameStoredFileValue } from '@/shared/lib/file-name'

interface EditInventorySheetProps {
  product: Product
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful save — use to refetch parent data instead of navigate(0). */
  onSaved?: () => void
}

export function EditInventorySheet({
  product,
  open,
  onOpenChange,
  onSaved,
}: EditInventorySheetProps) {
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  // Shared lookups — refresh when Settings → Units / Categories are edited, no reload.
  const { rows: unitsList } = useLookup('units', { enabled: open })
  const { rows: categoriesList } = useLookup('categories', { enabled: open })
  const { locations: locationsList } = useInventoryLocations({ enabled: open })

  // Controlled form state
  const [name, setName] = useState(product.name)
  const [unit, setUnit] = useState(product.unit || '')
  const [category, setCategory] = useState(product.category || '')
  const [image, setImage] = useState(product.image || '')
  // M10.3 — location + min-qty mirror; backend schema extension pending.
  const [location, setLocation] = useState(
    (product as unknown as { location?: string | null }).location ?? ''
  )
  const [expiryDate, setExpiryDate] = useState(toExpiryInput(product.expiryDate))
  const [hasExpiry, setHasExpiry] = useState(() => toExpiryInput(product.expiryDate) !== '')
  const [minQuantity, setMinQuantity] = useState(
    (product as unknown as { minQuantity?: number | null }).minQuantity != null
      ? String((product as unknown as { minQuantity?: number | null }).minQuantity)
      : String(product.reorderLevel ?? '')
  )

  // Fill the form each time the sheet opens for a record — not when a refetch
  // hands the same record back (a private file's link is re-signed every 15 min).
  useSeedOnOpen(open, product.id, () => {
    setName(product.name)
    setUnit(product.unit || '')
    setCategory(product.category || '')
    setImage(product.image || '')
    setLocation((product as unknown as { location?: string | null }).location ?? '')
    setMinQuantity(
      (product as unknown as { minQuantity?: number | null }).minQuantity != null
        ? String((product as unknown as { minQuantity?: number | null }).minQuantity)
        : String(product.reorderLevel ?? '')
    )
    setExpiryDate(toExpiryInput(product.expiryDate))
    setHasExpiry(toExpiryInput(product.expiryDate) !== '')
    setStatusMessage(undefined)
  })

  const isDirty = useMemo(() => {
    const initialLocation = (product as unknown as { location?: string | null }).location ?? ''
    const initialMinQty =
      (product as unknown as { minQuantity?: number | null }).minQuantity != null
        ? String((product as unknown as { minQuantity?: number | null }).minQuantity)
        : String(product.reorderLevel ?? '')
    return (
      name !== product.name ||
      unit !== (product.unit || '') ||
      category !== (product.category || '') ||
      !isSameStoredFileValue(image, product.image) ||
      location !== initialLocation ||
      minQuantity !== initialMinQty ||
      expiryDate !== toExpiryInput(product.expiryDate)
    )
  }, [product, name, unit, category, image, location, minQuantity, expiryDate])

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    // `&& !isSubmitting` matters: without it the guard's beforeunload listener
    // still counts the form as dirty while the save is in flight, so any
    // navigation triggered by a successful save raises the browser's
    // "Changes you made may not be saved" prompt over a save that did succeed.
    isDirty: isDirty && !isSubmitting,
    onClose: () => onOpenChange(false),
  })

  async function handleSubmit() {
    await submit(async () => {
      setStatusMessage(undefined)

      if (!name || name.trim() === '') {
        toast.error('Please enter the item name')
        return
      }
      if (!unit) {
        toast.error('Please select a unit')
        return
      }
      if (!category) {
        toast.error('Please select a category')
        return
      }
      if (hasExpiry && !expiryDate) {
        toast.error('Please enter the expiry date')
        return
      }

      const parsedMinQty = minQuantity.trim() ? parseInt(minQuantity, 10) : null
      if (
        parsedMinQty !== null &&
        (Number.isNaN(parsedMinQty) || !Number.isInteger(Number(minQuantity)))
      ) {
        toast.error('Minimum on hand must be a whole number')
        return
      }

      // NOTE: location and minQuantity are NOT included — those columns do not
      // exist in the inventory table yet (schema migration M10.3 pending).
      const data = {
        name,
        unit,
        category,
        reorderLevel: parsedMinQty != null ? parsedMinQty : (product.reorderLevel ?? 10),
        description: product.description || '',
        image: image || null,
        expiryDate: hasExpiry && expiryDate ? parseLocalDate(expiryDate) : null,
      }

      const result = await updateInventoryItem(product.id, data)

      if (result.success) {
        toast.success('Inventory item updated successfully.')
        onOpenChange(false)
        // Callers refetch through `onSaved`. This used to fall back to
        // window.location.reload(), which fought the dirty guard above and left
        // the user staring at a stale page after a save that had worked.
        onSaved?.()
      } else {
        const message = result.error || 'Something went wrong.'
        setStatusMessage(message)
        surfaceApiError(result, 'Something went wrong.')
      }
    })
  }

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Edit Inventory Item"
        description="Update inventory item details."
        size="md"
        submitLabel="Save Changes"
        submitting={isSubmitting}
        submitDisabled={!isDirty || isSubmitting}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Item Name</Label>
              <Input
                id="edit-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-unit">Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger id="edit-unit">
                  <SelectValue placeholder="Select Unit" />
                </SelectTrigger>
                <SelectContent>
                  {unitsList.map((u) => (
                    <SelectItem key={u.id} value={u.name}>
                      {u.displayName || u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="edit-category">
                <SelectValue placeholder="Select Category" />
              </SelectTrigger>
              <SelectContent>
                {categoriesList.map((cat) => (
                  <SelectItem key={cat.id} value={cat.name}>
                    {cat.name.charAt(0).toUpperCase() + cat.name.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-stockQuantity">Quantity</Label>
              <Input
                id="edit-stockQuantity"
                name="stockQuantity"
                type="number"
                value={product.stockQuantity ?? 0}
                readOnly
                disabled
              />
              <p className="text-xs text-muted-foreground">
                Stock changes go through Adjust stock (with a reason) so the ledger stays complete.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-minQuantity">Minimum on hand</Label>
              <Input
                id="edit-minQuantity"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 10"
                value={minQuantity}
                onChange={(e) => setMinQuantity(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Triggers a low-stock alert below this number.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-location">Location</Label>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger id="edit-location">
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
          <ExpiryDateField
            hasExpiry={hasExpiry}
            onHasExpiryChange={setHasExpiry}
            expiryDate={expiryDate}
            onExpiryDateChange={setExpiryDate}
            idPrefix="edit-inventory"
          />
          <div className="space-y-2">
            <Label>Item Image (Optional)</Label>
            <SingleImageUpload
              image={image || null}
              onChange={(url) => setImage(url || '')}
              maxSize={5 * 1024 * 1024}
              folder="inventory"
              entityName={product.name}
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
