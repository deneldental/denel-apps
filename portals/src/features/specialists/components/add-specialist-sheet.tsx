import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { createSpecialist, listSpecialtyOptions } from '@/lib/actions/specialists'
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
import { Switch } from '@/shared/components/ui/switch'

const UNSET = '__unset__'

type Form = {
  specialistType: 'internal' | 'external'
  name: string
  specialty: string
  contactEmail: string
  contactPhone: string
  tin: string
  defaultCommissionRate: string
  withholdingTaxRate: string
  createLogin: boolean
  password: string
}

const INITIAL: Form = {
  specialistType: 'internal',
  name: '',
  specialty: UNSET,
  contactEmail: '',
  contactPhone: '',
  tin: '',
  defaultCommissionRate: '',
  withholdingTaxRate: '',
  createLogin: false,
  password: '',
}

/**
 * Create a doctor / specialist.
 *
 * This is the clinic's single intake path — doctor management moved here from
 * the HR app so there is one place doctors are created.
 *
 * A doctor created here is a CLINICAL PROVIDER, not an HR employee: the backend
 * writes a `specialists` row and, optionally, a login. It does not create a
 * staff employment record, so doctors carry no payroll, attendance or leave.
 *
 * The login is provisioned with the `doctor` role and PORTAL scope only. That
 * grants the full clinical permission set — patients, appointments, medical
 * records, labs, payments, consents, analytics — and no staff or payroll
 * access. Doctors hold no Team-app scope, so there is deliberately no toggle
 * for it here.
 */
export function AddSpecialistSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
}) {
  const [form, setForm] = useState<Form>(INITIAL)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const { data: specialties = [] } = useQuery({
    queryKey: ['lookups', 'specialties'],
    queryFn: async () => {
      const res = await listSpecialtyOptions()
      return res.data ?? []
    },
    enabled: open,
  })

  const isInternal = form.specialistType === 'internal'

  function reset() {
    setForm(INITIAL)
  }

  function validate(): string | null {
    if (!form.name.trim()) return 'Name is required.'
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail))
      return 'That email address looks invalid.'
    if (form.createLogin) {
      if (!form.contactEmail.trim()) return 'An email address is required to create a login.'
      if (form.password.trim().length < 10) return 'Password must be at least 10 characters.'
    }
    for (const [label, v] of [
      ['Commission rate', form.defaultCommissionRate],
      ['Withholding tax rate', form.withholdingTaxRate],
    ] as const) {
      if (v === '') continue
      const n = Number(v)
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
    const res = await createSpecialist({
      name: form.name.trim(),
      specialty: form.specialty === UNSET ? null : form.specialty,
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      tin: form.tin.trim() || null,
      specialistType: form.specialistType,
      defaultCommissionRate:
        form.defaultCommissionRate === '' ? 0 : Number(form.defaultCommissionRate),
      withholdingTaxRate: form.withholdingTaxRate === '' ? 0 : Number(form.withholdingTaxRate),
      // Login is internal-only: an external doctor is a billing record with no
      // sign-in, so the backend ignores a password on an external specialist.
      ...(isInternal && form.createLogin
        ? { password: form.password.trim(), portalAccess: true }
        : {}),
    })
    setSaving(false)

    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success(
      isInternal && form.createLogin
        ? `${form.name.trim()} created with a portal login`
        : `${form.name.trim()} created`
    )
    reset()
    onOpenChange(false)
    onCreated()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add specialist</SheetTitle>
          <SheetDescription>
            Clinical providers patients book with. Internal specialists work for the clinic and can
            be given a portal login; external specialists are visiting providers paid on commission.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 py-6">
          <div className="space-y-1.5">
            <Label htmlFor="sp-type">Type</Label>
            <Select
              value={form.specialistType}
              onValueChange={(v) => set('specialistType', v as Form['specialistType'])}
            >
              <SelectTrigger id="sp-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">Internal — works for the clinic</SelectItem>
                <SelectItem value="external">External — visiting provider</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sp-name">
              Full name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sp-name"
              placeholder="e.g. Ama Mensah"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sp-specialty">Specialty</Label>
            <Select value={form.specialty} onValueChange={(v) => set('specialty', v)}>
              <SelectTrigger id="sp-specialty">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sp-email">Email</Label>
              <Input
                id="sp-email"
                type="email"
                placeholder="name@example.com"
                value={form.contactEmail}
                onChange={(e) => set('contactEmail', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-phone">Phone</Label>
              <Input
                id="sp-phone"
                placeholder="024 123 4567"
                value={form.contactPhone}
                onChange={(e) => set('contactPhone', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sp-commission">Commission %</Label>
              <Input
                id="sp-commission"
                inputMode="decimal"
                placeholder="0"
                value={form.defaultCommissionRate}
                onChange={(e) => set('defaultCommissionRate', e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sp-wht">Withholding %</Label>
              <Input
                id="sp-wht"
                inputMode="decimal"
                placeholder="0"
                value={form.withholdingTaxRate}
                onChange={(e) => set('withholdingTaxRate', e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sp-tin">TIN</Label>
              <Input
                id="sp-tin"
                placeholder="Optional"
                value={form.tin}
                onChange={(e) => set('tin', e.target.value)}
              />
            </div>
          </div>

          {isInternal && (
            <div className="space-y-4 rounded-md border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="sp-login">Create a portal login</Label>
                  <p className="text-xs text-muted-foreground">
                    Gives them the clinic portal with full clinical access — patients, appointments,
                    records, labs, payments and consents. No staff or payroll access, and no Team
                    app.
                  </p>
                </div>
                <Switch
                  id="sp-login"
                  checked={form.createLogin}
                  onCheckedChange={(v) => set('createLogin', v)}
                />
              </div>

              {form.createLogin && (
                <div className="space-y-1.5">
                  <Label htmlFor="sp-password">Temporary password</Label>
                  <Input
                    id="sp-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 10 characters"
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    They sign in with {form.contactEmail.trim() || 'their email address'}. They will
                    be asked to choose their own password the first time they sign in.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="mt-auto gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create specialist
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
