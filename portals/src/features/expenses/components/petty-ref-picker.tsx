import { Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createServiceProvider,
  getPettyCashStaff,
  getServiceProviders,
} from '@/lib/actions/petty-cash'
import { listSpecialistDirectory } from '@/lib/actions/specialists'
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

interface Option {
  id: string
  name: string
  contact: string | null
}

// No shared query-key group exists for petty-cash providers/staff or the
// specialist directory — local literals, module-scoped. `PETTY_PROVIDERS_KEY`
// and `PETTY_STAFF_KEY` intentionally use the same literal value as the ones
// in petty-providers-tab.tsx / petty-staff-tab.tsx (Petty Cash Settings), so
// adding/removing an entry there — or via this picker's inline "Add
// provider" — invalidates and refreshes both surfaces' caches together.
const PETTY_PROVIDERS_KEY = ['petty-cash', 'providers'] as const
const PETTY_STAFF_KEY = ['petty-cash', 'staff'] as const
const SPECIALIST_DIRECTORY_KEY = ['specialists', 'directory'] as const

/**
 * Petty-cash recipient picker — the morphed "Paid To" control on the expense form.
 * For `service_provider` it lists the reusable provider directory (with add-new
 * inline); for `staff` it lists the curated errand staff; for `specialist` it lists doctors.
 * Selecting fills the form's `pettyRefId` + `paidTo` (name).
 */
export function PettyRefPicker({
  refType,
  valueId,
  onChange,
}: {
  refType: 'service_provider' | 'staff' | 'specialist'
  valueId: string
  onChange: (id: string, name: string, contact: string | null) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContact, setNewContact] = useState('')
  const [saving, setSaving] = useState(false)

  // Three sibling queries (one per ref type), each gated by `enabled` so only
  // the active one actually fetches — keeps this a fixed set of hook calls
  // (rules-of-hooks) while sharing cache keys with the tabs that manage the
  // same lists (providers/staff), so adding one there refreshes this picker.
  const providersQuery = useApiQuery(PETTY_PROVIDERS_KEY, () => getServiceProviders(), {
    select: (rows) => (rows ?? []).map((p) => ({ id: p.id, name: p.name, contact: p.contact })),
    enabled: refType === 'service_provider',
  })
  const specialistsQuery = useApiQuery(SPECIALIST_DIRECTORY_KEY, () => listSpecialistDirectory(), {
    select: (rows) => (rows ?? []).map((s) => ({ id: s.id, name: s.name, contact: null })),
    enabled: refType === 'specialist',
  })
  const staffQuery = useApiQuery(PETTY_STAFF_KEY, () => getPettyCashStaff(), {
    select: (rows) =>
      (rows ?? []).map((s) => ({ id: s.staffId, name: s.fullName, contact: s.phone })),
    enabled: refType === 'staff',
  })

  const { options, loading }: { options: Option[]; loading: boolean } =
    refType === 'service_provider'
      ? { options: providersQuery.data ?? [], loading: providersQuery.isLoading }
      : refType === 'specialist'
        ? { options: specialistsQuery.data ?? [], loading: specialistsQuery.isLoading }
        : { options: staffQuery.data ?? [], loading: staffQuery.isLoading }

  function select(id: string) {
    const opt = options.find((o) => o.id === id)
    if (opt) onChange(opt.id, opt.name, opt.contact)
  }

  async function addProvider() {
    if (!newName.trim()) {
      toast.error('Provider name is required')
      return
    }
    setSaving(true)
    const res = await createServiceProvider({ name: newName.trim(), contact: newContact.trim() })
    setSaving(false)
    if (!res.success || !res.data) {
      toast.error(res.error ?? 'Failed to add provider')
      return
    }
    await providersQuery.refetch()
    onChange(res.data.id, res.data.name, res.data.contact)
    setAdding(false)
    setNewName('')
    setNewContact('')
  }

  const isProvider = refType === 'service_provider'
  const isSpecialist = refType === 'specialist'

  const label = isProvider
    ? 'Service provider *'
    : isSpecialist
      ? 'Doctor (Specialist) *'
      : 'Staff (errand) *'
  const placeholder = loading
    ? 'Loading…'
    : `Select ${isProvider ? 'provider' : isSpecialist ? 'doctor' : 'staff'}`

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Select value={valueId} onValueChange={select} disabled={loading}>
          <SelectTrigger>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">None yet</div>
            ) : (
              options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                  {o.contact ? ` · ${o.contact}` : ''}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {isProvider && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setAdding((a) => !a)}
            aria-label="Add provider"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {adding && isProvider && (
        <div className="space-y-2 rounded-md border p-3">
          <Input
            placeholder="Provider name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            placeholder="Phone (optional)"
            value={newContact}
            onChange={(e) => setNewContact(e.target.value)}
          />
          <Button type="button" size="sm" onClick={addProvider} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Add &amp; select
          </Button>
        </div>
      )}

      {!isProvider && !loading && options.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No errand staff yet — add them in Petty Cash → Staff.
        </p>
      )}
    </div>
  )
}
