import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import type { SupplierDetail } from '../types'

// ── Edit Supplier ─────────────────────────────────────────────────────────────

interface EditSupplierSheetProps {
  supplier: SupplierDetail
  open: boolean
  onOpenChange: (v: boolean) => void
  onSave: (updated: SupplierDetail) => void
}

export function EditSupplierSheet({
  supplier,
  open,
  onOpenChange,
  onSave,
}: EditSupplierSheetProps) {
  const [name, setName] = useState(supplier.name)
  const [phone, setPhone] = useState(supplier.contactPhone ?? '')
  const [email, setEmail] = useState(supplier.contactEmail ?? '')
  const [address, setAddress] = useState(supplier.address ?? '')
  const [paymentTerms, setPaymentTerms] = useState(supplier.paymentTerms ?? '')
  const [notes, setNotes] = useState(supplier.notes ?? '')
  const { isSubmitting, submit } = useSubmitGuard()

  useEffect(() => {
    if (open) {
      setName(supplier.name)
      setPhone(supplier.contactPhone ?? '')
      setEmail(supplier.contactEmail ?? '')
      setAddress(supplier.address ?? '')
      setPaymentTerms(supplier.paymentTerms ?? '')
      setNotes(supplier.notes ?? '')
    }
  }, [open, supplier])

  const isDirty =
    name !== supplier.name ||
    phone !== (supplier.contactPhone ?? '') ||
    email !== (supplier.contactEmail ?? '') ||
    address !== (supplier.address ?? '') ||
    paymentTerms !== (supplier.paymentTerms ?? '') ||
    notes !== (supplier.notes ?? '')

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  const handleSave = () =>
    submit(async () => {
      if (!name.trim()) return

      // Basic email format guard — browser HTML5 validation is bypassed by onClick
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        toast.error('Please enter a valid email address')
        return
      }

      const res = await api.patch(`/api/suppliers/${supplier.id}`, {
        name: name.trim(),
        contactPhone: phone.trim() || null,
        contactEmail: email.trim() || null,
        address: address.trim() || null,
        paymentTerms: paymentTerms.trim() || null,
        notes: notes.trim() || null,
      })

      if (!res.success) {
        surfaceApiError(res, 'Failed to update supplier')
        return
      }

      onSave({
        ...supplier,
        name: name.trim(),
        contactPhone: phone.trim() || null,
        contactEmail: email.trim() || null,
        address: address.trim() || null,
        paymentTerms: paymentTerms.trim() || null,
        notes: notes.trim() || null,
      })
      toast.success('Supplier updated')
      onOpenChange(false)
    })

  return (
    <>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <Sheet open={open} onOpenChange={guardedOnOpenChange}>
        <SheetContent className="sm:max-w-lg flex flex-col gap-0 p-0">
          <SheetHeader className="p-6 pb-4 border-b">
            <SheetTitle>Edit supplier</SheetTitle>
            <SheetDescription>Update contact and payment information.</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sup-name">Supplier name</Label>
              <Input
                id="sup-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={255}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sup-phone">Phone</Label>
                <Input
                  id="sup-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={30}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sup-email">Email</Label>
                <Input
                  id="sup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="optional"
                  maxLength={255}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-payment-terms">Payment terms</Label>
              <Input
                id="sup-payment-terms"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g. Net 30"
                maxLength={255}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-address">Address</Label>
              <Input
                id="sup-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="optional"
                maxLength={255}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-notes">Notes</Label>
              <Textarea
                id="sup-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="optional"
                maxLength={2000}
              />
            </div>
          </div>

          <SheetFooter className="p-6 pt-4 border-t gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button disabled={!isDirty || !name.trim() || isSubmitting} onClick={handleSave}>
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

// ── Add Price Item ────────────────────────────────────────────────────────────

interface AddPriceSheetProps {
  supplierId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onAdd: (item: { itemName: string; unit: string; unitPrice: number }) => Promise<void>
}

export function AddPriceSheet({
  supplierId: _supplierId,
  open,
  onOpenChange,
  onAdd,
}: AddPriceSheetProps) {
  const [itemName, setItemName] = useState('')
  const [unit, setUnit] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const { isSubmitting, submit } = useSubmitGuard()

  useEffect(() => {
    if (open) {
      setItemName('')
      setUnit('')
      setUnitPrice('')
    }
  }, [open])

  const canSave =
    itemName.trim() && unit.trim() && unitPrice.trim() && !Number.isNaN(parseFloat(unitPrice))

  const handleSave = () =>
    submit(async () => {
      if (!canSave) return
      await onAdd({
        itemName: itemName.trim(),
        unit: unit.trim(),
        // The API speaks CENTS; the input holds cedis.
        unitPrice: Math.round(parseFloat(unitPrice) * 100),
      })
      onOpenChange(false)
    })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-sm flex flex-col gap-0 p-0">
        <SheetHeader className="p-6 pb-4 border-b">
          <SheetTitle>Add price item</SheetTitle>
          <SheetDescription>Record a supplier price for a specific item.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="price-item">Item name</Label>
            <Input
              id="price-item"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. Composite Resin A2"
              maxLength={255}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="price-unit">Unit</Label>
            <Input
              id="price-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. box, piece, pack"
              maxLength={100}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="price-amount">Unit price (GHS)</Label>
            <Input
              id="price-amount"
              type="number"
              step="0.01"
              min="0"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>
        </div>

        <SheetFooter className="p-6 pt-4 border-t gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button disabled={!canSave || isSubmitting} onClick={handleSave}>
            {isSubmitting ? 'Saving…' : 'Add'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
