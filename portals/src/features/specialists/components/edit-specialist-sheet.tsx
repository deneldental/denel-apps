import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { listSpecialtyOptions, type Specialist, updateSpecialist } from '@/lib/actions/specialists'
import { useApiQuery } from '@/lib/query'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'

const UNSET = '__unset__'

type Form = {
  name: string
  specialty: string
  contactEmail: string
  contactPhone: string
  tin: string
  specialistType: 'internal' | 'external'
  defaultCommissionRate: string
  withholdingTaxRate: string
}

function toForm(s: Specialist): Form {
  return {
    name: s.name ?? '',
    specialty: s.specialty ?? UNSET,
    contactEmail: s.contactEmail ?? '',
    contactPhone: s.contactPhone ?? '',
    tin: s.tin ?? '',
    specialistType: s.specialistType === 'external' ? 'external' : 'internal',
    defaultCommissionRate: String(s.defaultCommissionRate ?? 0),
    withholdingTaxRate: String(s.withholdingTaxRate ?? 0),
  }
}

/**
 * Edit a specialist's profile and commission terms.
 *
 * Covers exactly what PATCH /api/specialists/:id accepts. Deliberately NOT here:
 *
 *   • the login — a specialist's user account, role and scopes are managed in
 *     Access Management, so this sheet can't quietly change who can sign in;
 *   • active/inactive — deactivating is a separate, consequential action;
 *   • payout account details — a structured blob with its own editor.
 *
 * Commission and withholding are percentages; the backend rejects anything
 * outside 0–100 (a 150% rate would accrue more commission than the invoice line
 * is worth), and the same bound is checked here so the error arrives before the
 * round-trip.
 */
export function EditSpecialistSheet({
  specialist,
  open,
  onOpenChange,
  onSaved,
}: {
  specialist: Specialist
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Form>(() => toForm(specialist))
  const [saving, setSaving] = useState(false)

  // Re-seed whenever the sheet opens, so a cancelled edit never leaks into the
  // next one and a record refreshed underneath us shows current values.
  useEffect(() => {
    if (open) setForm(toForm(specialist))
  }, [open, specialist])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  // No shared query-key group exists for the specialties lookup — local
  // literal, module-scoped.
  const { data: specialties = [] } = useApiQuery(
    ['lookups', 'specialties'] as const,
    () => listSpecialtyOptions(),
    { enabled: open }
  )

  function validate(): string | null {
    if (!form.name.trim()) return 'Name is required.'
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail))
      return 'That email address looks invalid.'
    for (const [label, v] of [
      ['Commission rate', form.defaultCommissionRate],
      ['Withholding tax rate', form.withholdingTaxRate],
    ] as const) {
      const n = Number(v === '' ? 0 : v)
      if (!Number.isFinite(n) || n < 0 || n > 100) return `${label} must be between 0 and 100.`
    }
    return null
  }

  async function handleSave() {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }

    setSaving(true)
    const res = await updateSpecialist(specialist.id, {
      name: form.name.trim(),
      specialty: form.specialty === UNSET ? null : form.specialty,
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      tin: form.tin.trim() || null,
      specialistType: form.specialistType,
      defaultCommissionRate:
        form.defaultCommissionRate === '' ? 0 : Number(form.defaultCommissionRate),
      withholdingTaxRate: form.withholdingTaxRate === '' ? 0 : Number(form.withholdingTaxRate),
    })
    setSaving(false)

    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Specialist updated')
    onOpenChange(false)
    onSaved()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit specialist</SheetTitle>
          <SheetDescription>
            Profile and commission terms. Sign-in access is managed in Access Management.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 py-6">
          <div className="space-y-1.5">
            <Label htmlFor="ed-name">
              Full name <span className="text-destructive">*</span>
            </Label>
            <Input id="ed-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ed-specialty">Specialty</Label>
            <Select value={form.specialty} onValueChange={(v) => set('specialty', v)}>
              <SelectTrigger id="ed-specialty">
                <SelectValue placeholder="Select a specialty" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Not specified</SelectItem>
                {specialties.map((s) => (
                  <SelectItem key={s.id} value={s.name}>
                    {s.displayName || s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ed-type">Type</Label>
            <Select
              value={form.specialistType}
              onValueChange={(v) => set('specialistType', v as Form['specialistType'])}
            >
              <SelectTrigger id="ed-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">Internal — works for the clinic</SelectItem>
                <SelectItem value="external">External — visiting provider</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ed-email">Email</Label>
              <Input
                id="ed-email"
                type="email"
                value={form.contactEmail}
                onChange={(e) => set('contactEmail', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-phone">Phone</Label>
              <Input
                id="ed-phone"
                value={form.contactPhone}
                onChange={(e) => set('contactPhone', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ed-commission">Commission %</Label>
              <Input
                id="ed-commission"
                inputMode="decimal"
                value={form.defaultCommissionRate}
                onChange={(e) => set('defaultCommissionRate', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-wht">Withholding %</Label>
              <Input
                id="ed-wht"
                inputMode="decimal"
                value={form.withholdingTaxRate}
                onChange={(e) => set('withholdingTaxRate', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-tin">TIN</Label>
              <Input id="ed-tin" value={form.tin} onChange={(e) => set('tin', e.target.value)} />
            </div>
          </div>
        </div>

        <SheetFooter className="mt-auto gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
