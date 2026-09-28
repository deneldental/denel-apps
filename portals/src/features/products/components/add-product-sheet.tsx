import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createProduct } from '@/lib/actions/products'
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
import { Switch } from '@/shared/components/ui/switch'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useLookup } from '@/shared/hooks/use-lookup'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { parseLocalDate } from '@/shared/lib/dates'
import { inputToCents } from '@/shared/utils/currency'
import { SingleImageUpload } from './single-image-upload'

interface AddProductSheetProps {
  buttonText?: string
  disabled?: boolean
  isAdmin?: boolean
  /** Called after the product is successfully created so the parent can refetch. */
  onSuccess?: () => void | Promise<void>
}

/**
 * Add-product form as a right-side Sheet. Self-contained — renders its own
 * trigger button and manages open state internally, matching the dialog's
 * original API so callers only change the import/name.
 */
export function AddProductSheet({
  buttonText = 'Add Product',
  disabled = false,
  isAdmin = false,
  onSuccess,
}: AddProductSheetProps) {
  const [open, setOpen] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const [image, setImage] = useState<string | null>(null)
  const [productName, setProductName] = useState<string>('')
  const [sizeValue, setSizeValue] = useState<string>('')
  const [sizeUnit, setSizeUnit] = useState<string>('')
  const [quantityPerPack, setQuantityPerPack] = useState<string>('1')
  const [stockQuantity, setStockQuantity] = useState<string>('0')
  const [price, setPrice] = useState<string>('')
  const [costPrice, setCostPrice] = useState<string>('')
  const [isLocked, setIsLocked] = useState<boolean>(false)
  const [hasExpiry, setHasExpiry] = useState<boolean>(false)
  const [expiryDate, setExpiryDate] = useState<string>('')

  // Shared units lookup — refreshes when Settings → Units is edited, no reload.
  const { rows: unitList } = useLookup('units', { enabled: open })

  const isDirty = useMemo(() => {
    return (
      image !== null ||
      productName !== '' ||
      sizeValue !== '' ||
      sizeUnit !== '' ||
      quantityPerPack !== '1' ||
      stockQuantity !== '0' ||
      price !== '' ||
      costPrice !== '' ||
      isLocked !== false ||
      hasExpiry ||
      expiryDate !== ''
    )
  }, [
    image,
    productName,
    sizeValue,
    sizeUnit,
    quantityPerPack,
    stockQuantity,
    price,
    costPrice,
    isLocked,
    hasExpiry,
    expiryDate,
  ])

  function resetForm() {
    setImage(null)
    setProductName('')
    setSizeValue('')
    setSizeUnit('')
    setQuantityPerPack('1')
    setStockQuantity('0')
    setPrice('')
    setCostPrice('')
    setIsLocked(false)
    setHasExpiry(false)
    setExpiryDate('')
    setStatusMessage(undefined)
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => {
      setOpen(false)
      resetForm()
    },
  })

  async function handleSubmit() {
    await submit(async () => {
      setStatusMessage(undefined)

      const priceCents = inputToCents(price)
      const quantityPerPackNum = parseInt(quantityPerPack, 10)
      const stockQuantityNum = parseInt(stockQuantity, 10)
      const sizeValueNum = sizeValue ? parseInt(sizeValue, 10) : null
      // Treat 0 as 'not entered' to match backend normalisation (0 → null)
      let costPriceCents: number | null =
        costPrice && costPrice.trim() !== '' && costPrice !== '0' ? inputToCents(costPrice) : null
      if (costPriceCents === 0) costPriceCents = null

      if (!productName || productName.trim() === '') {
        toast.error('Please enter a product name')
        return
      }

      // price must be a positive number (0 is not a valid selling price)
      if (priceCents <= 0) {
        toast.error('Please enter a valid selling price greater than zero')
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

      // Reject decimal sizeValue — the DB column is integer
      if (sizeValue && !/^\d+$/.test(sizeValue.trim())) {
        toast.error('Product size must be a whole number')
        return
      }

      // Force unit to be selected if value is entered
      if (sizeValueNum && !sizeUnit) {
        toast.error('Please select a unit for the product size')
        return
      }

      if (hasExpiry && !expiryDate) {
        toast.error('Please enter the expiry date')
        return
      }

      interface ProductData {
        name: string
        sku: string
        description?: string | null
        price: number
        costPrice?: number | null
        category?: string | null
        image?: string | null
        stockQuantity: number
        quantityPerPack: number
        /** Default reorder threshold — no UI input at creation time */
        reorderLevel?: number
        sizeValue?: number | null
        sizeUnit?: string | null
        isLocked?: boolean
        expiryDate?: Date | null
      }

      const skuTimestamp = Date.now().toString(36)
      const data: ProductData = {
        name: productName,
        sku: `PRD-${skuTimestamp}`, // Auto-generate SKU with base36 timestamp
        price: priceCents, // Selling price per single item (integer cents)
        costPrice: costPriceCents, // Cost price per pack (integer cents, null when not set)
        stockQuantity: stockQuantityNum, // Number of packs/units
        quantityPerPack: quantityPerPackNum, // Number of items per pack
        reorderLevel: 10, // Default — deferred: no reorderLevel field at creation
        description: null, // nullable column; no description field at creation time
        image: image || null, // Product image
        sizeValue: sizeValueNum,
        sizeUnit: sizeUnit || null,
        expiryDate: hasExpiry && expiryDate ? parseLocalDate(expiryDate) : null,
      }

      if (isAdmin) {
        data.isLocked = isLocked
      }

      const result = await createProduct(data)

      if (result.success) {
        toast.success('Product created successfully.')
        setOpen(false)
        resetForm()
        onSuccess?.()
      } else {
        setStatusMessage(result.error || 'Something went wrong.')
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
        title="Add Product"
        description="Enter product details for retail sale."
        size="md"
        submitLabel="Create Product"
        submitting={isSubmitting}
        submitDisabled={!isDirty || !productName.trim() || !price}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-4">
          <div className="space-y-2">
            <div className="max-w-[200px] mx-auto">
              <SingleImageUpload
                image={image}
                onChange={setImage}
                maxSize={5 * 1024 * 1024}
                folder="products"
                entityName={productName || 'product'}
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
            <Label htmlFor="name">Product Name</Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g., Toothbrush"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
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
              <Label htmlFor="quantityPerPack">Quantity per Pack</Label>
              <Input
                id="quantityPerPack"
                name="quantityPerPack"
                type="number"
                placeholder="12"
                value={quantityPerPack}
                onChange={(e) => setQuantityPerPack(e.target.value)}
                min="1"
                required
              />
              <p className="text-xs text-muted-foreground">Items in one pack</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stockQuantity">Number of Packs</Label>
              <Input
                id="stockQuantity"
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
            <Label htmlFor="price">Selling Price per Item (₵)</Label>
            <Input
              id="price"
              name="price"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">Price for a single item (not per pack)</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="costPrice">
              Cost Price per Pack (₵) <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="costPrice"
              name="costPrice"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Cost price for a pack</p>
          </div>
          <ExpiryDateField
            hasExpiry={hasExpiry}
            onHasExpiryChange={setHasExpiry}
            expiryDate={expiryDate}
            onExpiryDateChange={setExpiryDate}
            idPrefix="add-product"
          />
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
