import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import type { InsuranceCompany } from '../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  company: InsuranceCompany | null
  onSaved: () => void
}

/**
 * Add / Edit insurance company form, migrated from the legacy modal Dialog
 * to the standard `<SheetFormLayout>` slide-over (M6 dialog->sheet pass).
 *
 * Mirrors the previous CompanyFormDialog field-for-field; only the surrounding
 * surface changed. Server contract (POST/PATCH `/api/insurance/companies`)
 * stays identical.
 */
export function CompanyFormSheet({ open, onOpenChange, company, onSaved }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)
  const { isSubmitting, submit } = useSubmitGuard()

  // Re-seed fields whenever the sheet (re)opens — `company` may have changed
  // between an "edit A" and "edit B" cycle while the component stayed mounted.
  useEffect(() => {
    if (open) {
      setName(company?.name ?? '')
      setContactEmail(company?.contactEmail ?? '')
      setContactPhone(company?.contactPhone ?? '')
      setAddress(company?.address ?? '')
      setNotes(company?.notes ?? '')
      setActive(company?.active ?? true)
    }
  }, [open, company])

  // Compute dirty: any field differs from the seeded (saved) values
  const seedName = company?.name ?? ''
  const seedEmail = company?.contactEmail ?? ''
  const seedPhone = company?.contactPhone ?? ''
  const seedAddress = company?.address ?? ''
  const seedNotes = company?.notes ?? ''
  const seedActive = company?.active ?? true
  const isDirty =
    name !== seedName ||
    contactEmail !== seedEmail ||
    contactPhone !== seedPhone ||
    address !== seedAddress ||
    notes !== seedNotes ||
    active !== seedActive

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  async function save() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    // Basic email format check
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      toast.error('Enter a valid email address')
      return
    }
    // Basic phone format check (6–20 digits/spaces/dashes/parens/plus)
    if (contactPhone && !/^\+?[\d\s()/-]{6,20}$/.test(contactPhone)) {
      toast.error('Enter a valid phone number')
      return
    }
    await submit(async () => {
      const payload = {
        name: name.trim(),
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        address: address || null,
        notes: notes || null,
        active,
      }
      const res = company
        ? await api.patch(`/api/insurance/companies/${company.id}`, payload)
        : await api.post('/api/insurance/companies', payload)
      if (res.success) {
        toast.success(company ? 'Company updated' : 'Company created')
        // The shared `useInsuranceCompanies()` list is cached for 30 min, so a
        // new/renamed insurer would otherwise not reach the patient + claim
        // pickers until the cache expired.
        void queryClient.invalidateQueries({ queryKey: queryKeys.insurance.all })
        onOpenChange(false)
        onSaved()
      } else {
        surfaceApiError(res)
      }
    })
  }

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title={`${company ? 'Edit' : 'New'} Insurance Company`}
        description="Track contact info and current pricing partner status."
        size="md"
        submitLabel={company ? 'Save' : 'Create'}
        submitting={isSubmitting}
        submitDisabled={!name.trim()}
        onSubmit={save}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">Name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nationwide Medical"
              maxLength={255}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="company-email">Email</Label>
              <Input
                id="company-email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="contact@..."
                maxLength={255}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-phone">Phone</Label>
              <Input
                id="company-phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                maxLength={255}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-address">Address</Label>
            <Input
              id="company-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={255}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-notes">Notes</Label>
            <Textarea
              id="company-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Show in selection dropdowns</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
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
