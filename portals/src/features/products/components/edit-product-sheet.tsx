import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { Product } from '@/features/products/pages/columns'
import { updateProduct } from '@/lib/actions/products'
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
import { Switch } from '@/shared/components/ui/switch'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useLookup } from '@/shared/hooks/use-lookup'
import { useSeedOnOpen } from '@/shared/hooks/use-seed-on-open'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { parseLocalDate } from '@/shared/lib/dates'
import { isSameStoredFileValue } from '@/shared/lib/file-name'
import { centsToInput, inputToCents } from '@/shared/utils/currency'
import { SingleImageUpload } from './single-image-upload'

/** `products` is served from the merged `items` table — see the note in the body. */
type ProductWithExpiry = Product & { expiryDate?: string | Date | null }

interface EditProductSheetProps {
  product: Product
  open: boolean
  onOpenChange: (open: boolean) => void
  isAdmin?: boolean
  onSuccess?: () => void
}

export function EditProductSheet({
  product,
  open,
  onOpenChange,
  isAdmin = false,
  onSuccess,
}: EditProductSheetProps) {
  const _navigate = useNavigate()
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const [image, setImage] = useState<string | null>(product.image || null)
  const [name, setName] = useState<string>(product.name)
  const [sizeValue, setSizeValue] = useState<string>(
    product.sizeValue != null ? String(product.sizeValue) : ''
  )
  const [sizeUnit, setSizeUnit] = useState<string>(product.sizeUnit || '')
  const [quantityPerPack, setQuantityPerPack] = useState<string>(
    String(product.quantityPerPack ?? 1)
  )
  const [stockQuantity, setStockQuantity] = useState<string>(String(product.stockQuantity ?? 0))
  const [price, setPrice] = useState<string>(String(product.price ?? ''))
  const [costPrice, setCostPrice] = useState<string>(
    product.costPrice != null ? String(product.costPrice) : ''
  )
  const [isLocked, setIsLocked] = useState<boolean>(product.isLocked || false)
  // The API serves products out of the unified `items` table, which carries
  // expiryDate; the legacy `products` type this component is written against
  // predates that merge, so the field is read through a narrow cast.
  const initialExpiry = toExpiryInput((product as ProductWithExpiry).expiryDate)
  const [expiryDate, setExpiryDate] = useState<string>(initialExpiry)
  const [hasExpiry, setHasExpiry] = useState<boolean>(initialExpiry !== '')

  // Shared units lookup — refreshes when Settings → Units is edited, no reload.
  const { rows: unitList } = useLookup('units', { enabled: open })

  // Fill the form each time the sheet opens for a record — not when a refetch
  // hands the same record back (a private file's link is re-signed every 15 min).
  useSeedOnOpen(open, product.id, () => {
    setImage(product.image || null)
    setName(product.name)
    setSizeValue(product.sizeValue != null ? String(product.sizeValue) : '')
    setSizeUnit(product.sizeUnit || '')
    setQuantityPerPack(String(product.quantityPerPack ?? 1))
    setStockQuantity(String(product.stockQuantity ?? 0))
    setPrice(product.price != null ? centsToInput(product.price) : '')
    setCostPrice(product.costPrice != null ? centsToInput(product.costPrice) : '')
    setIsLocked(product.isLocked || false)
    const nextExpiry = toExpiryInput((product as ProductWithExpiry).expiryDate)
    setExpiryDate(nextExpiry)
    setHasExpiry(nextExpiry !== '')
    setStatusMessage(undefined)
  })

  const isDirty = useMemo(() => {
    return (
      !isSameStoredFileValue(image, product.image) ||
      name !== product.name ||
      sizeValue !== (product.sizeValue != null ? String(product.sizeValue) : '') ||
      sizeUnit !== (product.sizeUnit || '') ||
      quantityPerPack !== String(product.quantityPerPack ?? 1) ||
      stockQuantity !== String(product.stockQuantity ?? 0) ||
      price !== (product.price != null ? centsToInput(product.price) : '') ||
      costPrice !== (product.costPrice != null ? centsToInput(product.costPrice) : '') ||
      isLocked !== (product.isLocked || false) ||
      expiryDate !== toExpiryInput((product as ProductWithExpiry).expiryDate)
    )
  }, [
    product,
    image,
    name,
    sizeValue,
    sizeUnit,
    quantityPerPack,
    stockQuantity,
    price,
    costPrice,
    isLocked,
    expiryDate,
  ])

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => onOpenChange(false),
  })

  function handleSubmit() {
    void submit(async () => {
      setStatusMessage(undefined)

      const priceCents = inputToCents(price)
      const quantityPerPackNum = parseInt(quantityPerPack, 10)
      const stockQuantityNum = parseInt(stockQuantity, 10)
      // sizeValue must be a whole number (integer column in DB)
      const sizeValueNum = sizeValue ? parseInt(sizeValue, 10) : null
      const costPriceCents =
        costPrice && costPrice.trim() !== '' && costPrice !== '0' ? inputToCents(costPrice) : null

      if (!name || name.trim() === '') {
        toast.error('Please enter a product name')
        return
      }

      if (priceCents <= 0) {
        toast.error('Selling price must be greater than zero')
        return
      }

      if (Number.isNaN(quantityPerPackNum) || quantityPerPackNum < 1) {
        toast.error('Quantity per pack must be at least 1')
        return
      }

      if (Number.isNaN(stockQuantityNum) || stockQuantityNum < 0) {
        toast.error('Number of packs must be 0 or more')
        return
      }

      // Validate sizeValue is a whole number if provided
      if (sizeValue && !/^\d+$/.test(sizeValue.trim())) {
        toast.error('Size must be a whole number')
        return
      }

      // Force unit to be selected if value is entered
      if (sizeValueNum && !sizeUnit) {
        toast.error('Please select a unit for the product size')
        return
      }

      // Symmetric check: unit selected but no value entered
      if (sizeUnit && !sizeValueNum) {
        toast.error('Please enter a size value for the selected unit')
        return
      }

      if (hasExpiry && !expiryDate) {
        toast.error('Please enter the expiry date')
        return
      }

      const data: Partial<Product> & { expiryDate?: Date | null } = {
        name,
        price: priceCents, // Selling price per single item (integer cents)
        costPrice: costPriceCents, // Cost price per pack (integer cents)
        stockQuantity: stockQuantityNum, // Number of packs
        quantityPerPack: quantityPerPackNum, // Number of items per pack
        image: image || null, // Product image
        sizeValue: sizeValueNum,
        sizeUnit: sizeUnit || null,
        expiryDate: hasExpiry && expiryDate ? parseLocalDate(expiryDate) : null,
      }

      if (isAdmin) {
        data.isLocked = isLocked
      }

      const result = await updateProduct(product.id, data)

      if (result.success) {
        toast.success('Product updated successfully.')
        onOpenChange(false)
        if (onSuccess) {
          onSuccess()
        }
      } else {
        const message = result.error || 'Something went wrong.'
        setStatusMessage(message)
        surfaceApiError(result)
      }
    })
  }

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Edit Product"
        description="Update product details for retail sale."
        size="md"
        submitLabel="Save Changes"
        submitting={isSubmitting}
        submitDisabled={!isDirty}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>Product Image</Label>
            <div className="max-w-[200px] mx-auto">
              <SingleImageUpload
                image={image}
                onChange={setImage}
                maxSize={5 * 1024 * 1024}
                folder="products"
                entityName={product.name}
              />
            </div>
          </div>

          {isAdmin && (
            <div className="flex flex-row items-center justify-between rounded-lg border p-4 bg-amber-500/10 border-amber-500/20">
              <div className="space-y-0.5">
                <Label className="text-base text-amber-700 dark:text-amber-400">Lock Product</Label>
                <p className="text-sm text-muted-foreground">
                  Prevent this product from being deleted.
                </p>
              </div>
              <Switch checked={isLocked} onCheckedChange={setIsLocked} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-name">Product Name</Label>
            <Input
              id="edit-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sizeValue">Product Size (Optional)</Label>
            <div className="flex gap-2">
              <Input
                id="sizeValue"
                name="sizeValue"
                type="number"
                step="1"
                min="1"
                placeholder="e.g., 250"
                value={sizeValue}
                onChange={(e) => setSizeValue(e.target.value)}
                className="flex-1"
              />
              <Select value={sizeUnit} onValueChange={setSizeUnit}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Select Unit" />
                </SelectTrigger>
                <SelectContent>
                  {unitList.map((unit) => (
                    <SelectItem key={unit.id} value={unit.name}>
                      {unit.displayName || unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">Values like 20ml, 500g, etc.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-quantityPerPack">Quantity per Pack</Label>
              <Input
                id="edit-quantityPerPack"
                name="quantityPerPack"
                type="number"
                value={quantityPerPack}
                onChange={(e) => setQuantityPerPack(e.target.value)}
                min="1"
                required
              />
              <p className="text-xs text-muted-foreground">Items in one pack</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-stockQuantity">Number of Packs</Label>
              <Input
                id="edit-stockQuantity"
                name="stockQuantity"
                type="number"
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                min="0"
                required
              />
              <p className="text-xs text-muted-foreground">Packs in stock</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-price">Selling Price per Item (₵)</Label>
            <Input
              id="edit-price"
              name="price"
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">Price for a single item (not per pack)</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-costPrice">
              Cost Price per Pack (₵) <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="edit-costPrice"
              name="costPrice"
              type="number"
              step="0.01"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground">Cost price for a pack</p>
          </div>
          <ExpiryDateField
            hasExpiry={hasExpiry}
            onHasExpiryChange={setHasExpiry}
            expiryDate={expiryDate}
            onExpiryDateChange={setExpiryDate}
            idPrefix="edit-product"
          />
          <div className="space-y-2">
            <Label htmlFor="edit-sku">SKU</Label>
            <Input id="edit-sku" name="sku" defaultValue={product.sku || 'N/A'} disabled readOnly />
            <p className="text-xs text-muted-foreground">Product SKU (auto-generated)</p>
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
