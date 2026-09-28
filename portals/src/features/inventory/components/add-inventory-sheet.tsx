import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { SingleImageUpload } from '@/features/products/components/single-image-upload'
import { createInventoryItem } from '@/lib/actions/inventory'
import { listSuppliers, type Supplier } from '@/lib/actions/suppliers'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { ExpiryDateField } from '@/shared/components/expiry-date-field'
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
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useInventoryLocations } from '@/shared/hooks/use-inventory-locations'
import { useLookup } from '@/shared/hooks/use-lookup'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { parseLocalDate } from '@/shared/lib/dates'

interface AddInventorySheetProps {
  buttonText?: string
  disabled?: boolean
  onSaved?: () => void
}

/**
 * Add-inventory form as a right-side Sheet. Self-contained — renders its own
 * trigger button and manages open state internally, matching the dialog's
 * original API so callers only change the import/name.
 */
export function AddInventorySheet({
  buttonText = 'Add Item',
  disabled = false,
  onSaved,
}: AddInventorySheetProps) {
  const [open, setOpen] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  // Shared lookups — refresh when Settings → Units / Categories are edited, no reload.
  const { rows: unitsList } = useLookup('units', { enabled: open })
  const { rows: categoriesList } = useLookup('categories', { enabled: open })
  const [suppliersList, setSuppliersList] = useState<Supplier[]>([])
  const { locations: locationsList } = useInventoryLocations({ enabled: open })
  const [supplierId, setSupplierId] = useState('')

  // Controlled form state
  const [itemName, setItemName] = useState('')
  const [unit, setUnit] = useState('')
  const [category, setCategory] = useState('')
  const [stockQuantity, setStockQuantity] = useState('0')
  const [image, setImage] = useState('')
  // M10.3 — location tracked in local state for future backend schema extension.
  // location is NOT sent in the payload until the DB column is added.
  // TODO(backend-wiring): persist location column and re-wire.
  const [location, setLocation] = useState('')
  const [minQuantity, setMinQuantity] = useState('')
  const [hasExpiry, setHasExpiry] = useState(false)
  const [expiryDate, setExpiryDate] = useState('')

  useEffect(() => {
    if (!open) return
    listSuppliers().then((suppRes) => {
      if (suppRes.success) setSuppliersList(suppRes.data.filter((s) => s.active))
      else toast.error('Failed to load suppliers — please close and reopen')
    })
  }, [open])

  const isDirty = useMemo(() => {
    return (
      itemName !== '' ||
      unit !== '' ||
      category !== '' ||
      stockQuantity !== '0' ||
      image !== '' ||
      location !== '' ||
      minQuantity !== '' ||
      supplierId !== '' ||
      hasExpiry ||
      expiryDate !== ''
    )
  }, [
    itemName,
    unit,
    category,
    stockQuantity,
    image,
    location,
    minQuantity,
    supplierId,
    hasExpiry,
    expiryDate,
  ])

  function resetForm() {
    setItemName('')
    setUnit('')
    setCategory('')
    setStockQuantity('0')
    setImage('')
    setLocation('')
    setMinQuantity('')
    setSupplierId('')
    setHasExpiry(false)
    setExpiryDate('')
    setStatusMessage(undefined)
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => {
      setOpen(false)
      resetForm()
    },
  })

  async function handleSubmit() {
    setStatusMessage(undefined)

    if (!itemName || itemName.trim() === '') {
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
    const stockNum = parseInt(stockQuantity, 10)
    if (Number.isNaN(stockNum) || stockNum < 0) {
      toast.error('Please enter a valid stock quantity')
      return
    }
    if (hasExpiry && !expiryDate) {
      toast.error('Please enter the expiry date')
      return
    }

    await submit(async () => {
      interface InventoryData {
        name: string
        unit: string
        category: string
        stockQuantity: number
        reorderLevel?: number
        description?: string
        image?: string | null
        supplierId?: string | null
        expiryDate?: Date | null
      }
      const parsedMinQty = minQuantity.trim() ? parseInt(minQuantity, 10) : null
      const data: InventoryData = {
        name: itemName.trim(),
        unit,
        category,
        stockQuantity: stockNum,
        reorderLevel: parsedMinQty != null && !Number.isNaN(parsedMinQty) ? parsedMinQty : 10,
        description: '',
        image: image || null,
        supplierId: supplierId || null,
        expiryDate: hasExpiry && expiryDate ? parseLocalDate(expiryDate) : null,
      }

      const result = await createInventoryItem(data)

      if (result.success) {
        toast.success('Inventory item created successfully.')
        setOpen(false)
        resetForm()
        onSaved?.()
      } else {
        const message = result.error || 'Something went wrong.'
        setStatusMessage(message)
        surfaceApiError(result)
      }
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled}>
        <Plus className="mr-2 h-4 w-4" />
        {buttonText}
      </Button>

      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Add Inventory Item"
        description="Add a new item to the clinic inventory."
        size="md"
        submitLabel="Create Item"
        submitting={isSubmitting}
        submitDisabled={!isDirty || !unit || !category}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Item Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g., Gloves"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger id="unit">
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
            <Label htmlFor="category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category">
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
              <Label htmlFor="stockQuantity">Quantity</Label>
              <Input
                id="stockQuantity"
                name="stockQuantity"
                type="number"
                min="0"
                step="1"
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Initial stock quantity</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="minQuantity">Minimum on hand</Label>
              <Input
                id="minQuantity"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 10"
                value={minQuantity}
                onChange={(e) => setMinQuantity(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Triggers a low-stock alert below this number (default: 10).
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger id="location">
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
            idPrefix="add-inventory"
          />
          <div className="space-y-2">
            <Label htmlFor="supplier">Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger id="supplier">
                <SelectValue placeholder="Select a supplier (optional)" />
              </SelectTrigger>
              <SelectContent>
                {suppliersList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Item Image (Optional)</Label>
            <SingleImageUpload
              image={image || null}
              onChange={(url) => setImage(url || '')}
              maxSize={5 * 1024 * 1024}
              folder="inventory"
              entityName={itemName || 'item'}
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
