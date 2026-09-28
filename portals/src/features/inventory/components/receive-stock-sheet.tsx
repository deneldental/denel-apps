import { useQueryClient } from '@tanstack/react-query'
import { Paperclip, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getInventoryItems, receiveInventory } from '@/lib/actions/inventory'
import { listSuppliers, type Supplier } from '@/lib/actions/suppliers'
import { uploadFile } from '@/lib/actions/upload'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
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
import { cedisToCents, formatCurrency } from '@/shared/utils/currency'

interface InventoryListItem {
  id: string
  name: string
}

interface ReceiveLine {
  id: string // client-only UUID for keying
  itemId: string
  qty: string
  unitCost: string
  locationId: string
  expiryDate: string
  lotNumber: string
}

function makeEmptyLine(): ReceiveLine {
  return {
    id: crypto.randomUUID(),
    itemId: '',
    qty: '',
    unitCost: '',
    locationId: '',
    expiryDate: '',
    lotNumber: '',
  }
}

interface ReceiveStockSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
  defaultItemId?: string
}

export function ReceiveStockSheet({
  open,
  onOpenChange,
  onSaved,
  defaultItemId,
}: ReceiveStockSheetProps) {
  const queryClient = useQueryClient()
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reference data
  const [itemsList, setItemsList] = useState<InventoryListItem[]>([])
  const [suppliersList, setSuppliersList] = useState<Supplier[]>([])
  const { locations: locationsList } = useInventoryLocations({ enabled: open })

  // Form state
  const [lines, setLines] = useState<ReceiveLine[]>([makeEmptyLine()])
  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const [paidNow, setPaidNow] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank' | ''>('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [isUploadingFile, setIsUploadingFile] = useState(false)

  // Load reference data when sheet opens; pre-populate first line if defaultItemId given
  useEffect(() => {
    if (!open) return
    if (defaultItemId) {
      setLines([{ ...makeEmptyLine(), itemId: defaultItemId }])
    }
    Promise.all([getInventoryItems(), listSuppliers()]).then(([invRes, suppRes]) => {
      if (invRes.success) {
        setItemsList(
          invRes.data.map((i: { id: string; name: string }) => ({ id: i.id, name: i.name }))
        )
      }
      if (suppRes.success) setSuppliersList(suppRes.data.filter((s) => s.active))
    })
  }, [open, defaultItemId])

  // Dirty check
  const isDirty = useMemo(() => {
    const defaultLine = makeEmptyLine()
    const linesChanged =
      lines.length > 1 ||
      (lines.length === 1 &&
        (lines[0].itemId !== defaultLine.itemId ||
          lines[0].qty !== defaultLine.qty ||
          lines[0].unitCost !== defaultLine.unitCost ||
          lines[0].locationId !== defaultLine.locationId ||
          lines[0].expiryDate !== defaultLine.expiryDate ||
          lines[0].lotNumber !== defaultLine.lotNumber))
    return linesChanged || supplierId !== '' || notes !== '' || paidNow || receiptFile !== null
  }, [lines, supplierId, notes, paidNow, receiptFile])

  function resetForm() {
    setLines([makeEmptyLine()])
    setSupplierId('')
    setNotes('')
    setPaidNow(false)
    setPaymentMethod('')
    setReceiptFile(null)
    setStatusMessage(undefined)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => {
      onOpenChange(false)
      resetForm()
    },
  })

  // Running total
  const runningTotal = useMemo(() => {
    return lines.reduce((sum, line) => {
      const qty = parseFloat(line.qty) || 0
      const cost = parseFloat(line.unitCost) || 0
      return sum + qty * cost
    }, 0)
  }, [lines])

  // Line operations
  function updateLine(index: number, patch: Partial<ReceiveLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((prev) => [...prev, makeEmptyLine()])
  }

  function removeLine(index: number) {
    setLines((prev) => {
      if (prev.length === 1) return [makeEmptyLine()]
      return prev.filter((_, i) => i !== index)
    })
  }

  async function handleSubmit() {
    setStatusMessage(undefined)

    // Validate lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.itemId) {
        toast.error(`Line ${i + 1}: please select an item`)
        return
      }
      const qty = parseFloat(line.qty)
      if (Number.isNaN(qty) || qty <= 0) {
        toast.error(`Line ${i + 1}: quantity must be greater than 0`)
        return
      }
      const cost = parseFloat(line.unitCost)
      if (Number.isNaN(cost) || cost < 0) {
        toast.error(`Line ${i + 1}: unit cost must be 0 or more`)
        return
      }
    }

    if (paidNow && !paymentMethod) {
      toast.error('Please select a payment method')
      return
    }

    await submit(async () => {
      try {
        let receiptUrl: string | null = null
        if (receiptFile) {
          setIsUploadingFile(true)
          const up = await uploadFile(receiptFile, {
            storageCategory: 'system_docs',
            folder: 'inventory/receipts',
            profile: 'imageOrPdf',
          })
          setIsUploadingFile(false)
          if (!up.success || !up.url) {
            toast.error('Failed to upload receipt document')
            return
          }
          receiptUrl = up.url
        }

        await receiveInventory({
          lines: lines.map((line) => ({
            itemId: line.itemId,
            qty: parseFloat(line.qty),
            unitCost: cedisToCents(parseFloat(line.unitCost)),
            locationId: line.locationId || null,
            expiryDate: line.expiryDate || null,
            lotNumber: line.lotNumber || null,
          })),
          supplierId: supplierId || null,
          notes: notes || null,
          paidNow,
          paymentMethod: paidNow && paymentMethod ? paymentMethod : null,
          receiptUrl,
        })
        toast.success('Stock received')
        queryClient.invalidateQueries({ queryKey: ['inventory'] })
        onOpenChange(false)
        resetForm()
        onSaved?.()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong'
        setStatusMessage(message)
        surfaceApiError({ error: message })
      }
    })
  }

  const hasAnyLine = lines.some((l) => l.itemId !== '')

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Receive Stock"
        description="Record a stock receipt. Each line adds inventory to the ledger."
        size="lg"
        submitLabel={isUploadingFile ? 'Uploading…' : 'Receive Stock'}
        submitting={isSubmitting || isUploadingFile}
        submitDisabled={!hasAnyLine}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-6">
          {/* Lines */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Items</p>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add line
              </Button>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[1fr_80px_90px_110px_110px_90px_32px] gap-2 text-xs text-muted-foreground px-0.5">
              <span>Item</span>
              <span>Qty</span>
              <span>Unit cost</span>
              <span>Location</span>
              <span>Expiry date</span>
              <span>Lot #</span>
              <span />
            </div>

            {lines.map((line, index) => (
              <div
                key={line.id}
                className="grid grid-cols-[1fr_80px_90px_110px_110px_90px_32px] gap-2 items-start"
              >
                {/* Item select */}
                <Select value={line.itemId} onValueChange={(v) => updateLine(index, { itemId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select item" />
                  </SelectTrigger>
                  <SelectContent>
                    {itemsList.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Qty */}
                <Input
                  type="number"
                  min="0.001"
                  step="1"
                  placeholder="0"
                  value={line.qty}
                  onChange={(e) => updateLine(index, { qty: e.target.value })}
                />

                {/* Unit cost */}
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={line.unitCost}
                  onChange={(e) => updateLine(index, { unitCost: e.target.value })}
                />

                {/* Location */}
                <Select
                  value={line.locationId}
                  onValueChange={(v) => updateLine(index, { locationId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locationsList.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                        {loc.code ? ` (${loc.code})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Expiry date */}
                <Input
                  type="date"
                  value={line.expiryDate}
                  onChange={(e) => updateLine(index, { expiryDate: e.target.value })}
                />

                {/* Lot number */}
                <Input
                  placeholder="Lot #"
                  value={line.lotNumber}
                  onChange={(e) => updateLine(index, { lotNumber: e.target.value })}
                  maxLength={100}
                />

                {/* Remove */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => removeLine(index)}
                  aria-label={`Remove line ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>

                {/* Per-line subtotal */}
                {line.qty && line.unitCost && (
                  <p className="col-span-full text-right text-xs text-muted-foreground pr-10">
                    Line subtotal:{' '}
                    {formatCurrency(
                      cedisToCents((parseFloat(line.qty) || 0) * (parseFloat(line.unitCost) || 0))
                    )}
                  </p>
                )}
              </div>
            ))}

            {/* Total */}
            {lines.length > 0 && (
              <div className="flex justify-end border-t pt-2">
                <p className="text-sm font-semibold">
                  Total: {formatCurrency(cedisToCents(runningTotal))}
                </p>
              </div>
            )}
          </div>

          {/* Supplier */}
          <div className="space-y-2">
            <Label htmlFor="receive-supplier">Supplier (optional)</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger id="receive-supplier">
                <SelectValue placeholder="Select supplier" />
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

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="receive-notes">Notes (optional)</Label>
            <textarea
              id="receive-notes"
              className="flex min-h-18 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Delivery note number, remarks, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
            />
          </div>

          {/* Receipt / supporting document */}
          <div className="space-y-2">
            <Label>Receipt / Supporting Document (optional)</Label>
            {receiptFile ? (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-muted-foreground">{receiptFile.name}</span>
                <button
                  type="button"
                  aria-label="Remove file"
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => {
                    setReceiptFile(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-ring hover:text-foreground transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4 shrink-0" />
                Attach receipt or delivery note (PDF or image)
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                setReceiptFile(file)
              }}
            />
          </div>

          {/* Payment */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Payment</p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="receive-paid-now"
                checked={paidNow}
                onCheckedChange={(checked) => {
                  setPaidNow(checked === true)
                  if (checked !== true) setPaymentMethod('')
                }}
              />
              <Label htmlFor="receive-paid-now" className="cursor-pointer font-normal">
                Paid now
              </Label>
            </div>

            {paidNow ? (
              <div className="space-y-2 pl-6">
                <Label htmlFor="receive-payment-method">Payment method</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(v) => setPaymentMethod(v as 'cash' | 'bank')}
                >
                  <SelectTrigger id="receive-payment-method">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="pl-6 text-sm text-muted-foreground">On account (AP)</p>
            )}
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
