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

interface AddSupplierSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onAdded: () => void
}

/** Shape of the supplier row returned inside ApiResponse.data by POST /api/suppliers */
interface SupplierRow {
  id: string
  name: string
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
  paymentTerms: string | null
  notes: string | null
  active: boolean
  tin: string | null
  defaultPaymentTermsDays: number | null
  createdAt: string
  updatedAt: string
}

export function AddSupplierSheet({ open, onOpenChange, onAdded }: AddSupplierSheetProps) {
  const [name, setName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [address, setAddress] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [notes, setNotes] = useState('')

  const { isSubmitting, submit } = useSubmitGuard()

  const isDirty =
    name !== '' ||
    contactPhone !== '' ||
    contactEmail !== '' ||
    address !== '' ||
    paymentTerms !== '' ||
    notes !== ''

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  useEffect(() => {
    if (open) {
      setName('')
      setContactPhone('')
      setContactEmail('')
      setAddress('')
      setPaymentTerms('')
      setNotes('')
    }
  }, [open])

  const handleSave = () => {
    submit(async () => {
      if (!name.trim()) {
        toast.error('Supplier name is required')
        return
      }
      if (!contactPhone.trim()) {
        toast.error('Phone number is required')
        return
      }
      const res = await api.post<SupplierRow>('/api/suppliers', {
        name: name.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail.trim() || null,
        address: address.trim() || null,
        paymentTerms: paymentTerms.trim() || null,
        notes: notes.trim() || null,
      })
      if (!res.success) {
        surfaceApiError(res, 'Failed to add supplier')
        return
      }
      toast.success('Supplier added')
      onOpenChange(false)
      onAdded()
    })
  }

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOnOpenChange}>
        <SheetContent className="sm:max-w-lg flex flex-col gap-0 p-0">
          <SheetHeader className="p-6 pb-4 border-b">
            <SheetTitle>Add supplier</SheetTitle>
            <SheetDescription>Add a new vendor to your supplier list.</SheetDescription>
          </SheetHeader>

          <form
            id="add-supplier-form"
            onSubmit={(e) => {
              e.preventDefault()
              handleSave()
            }}
            className="flex-1 overflow-y-auto p-6 space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="add-sup-name">
                Supplier name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="add-sup-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-sup-phone">
                  Phone <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="add-sup-phone"
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="e.g. 0244000000"
                  maxLength={30}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-sup-email">Email</Label>
                <Input
                  id="add-sup-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="optional"
                  maxLength={254}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-sup-address">Address</Label>
              <Input
                id="add-sup-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="optional"
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-sup-terms">Payment terms</Label>
              <Input
                id="add-sup-terms"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g. Net 30, COD"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-sup-notes">Notes</Label>
              <Textarea
                id="add-sup-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="optional"
                maxLength={2000}
              />
            </div>
          </form>

          <SheetFooter className="p-6 pt-4 border-t gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => guardedOnOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="add-supplier-form"
              disabled={!name.trim() || !contactPhone.trim() || isSubmitting}
            >
              {isSubmitting ? 'Adding…' : 'Add supplier'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
