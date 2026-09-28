import { useState } from 'react'
import { toast } from 'sonner'
import { type PettyCategory, type PettyRefType, setCategoryPetty } from '@/lib/actions/petty-cash'
import { useApiMutation } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Switch } from '@/shared/components/ui/switch'
import { useLookup } from '@/shared/hooks/use-lookup'

const REF_LABELS: Record<PettyRefType, string> = {
  none: 'No reference',
  service_provider: 'Service provider',
  staff: 'Staff (errand)',
}

/**
 * Settings — flag which existing expense categories are petty cash, and which
 * reference the expense form should require when one is chosen.
 *
 * Shares the `expense-categories` lookup cache with
 * `PettyCashPolicySection` (Settings' own copy of this same enrollment UI) and
 * every expense-category picker — a toggle here invalidates
 * `queryKeys.settings.lookup('expense-categories')`, so the other surface
 * refreshes instead of going stale.
 */
export function PettySettingsTab() {
  const { rows: categoryRows, isLoading: loading } = useLookup('expense-categories')
  const [overrides, setOverrides] = useState<
    Record<string, { isPettyCash: boolean; pettyRefType: PettyRefType }>
  >({})
  const categories: PettyCategory[] = categoryRows.map((c) => {
    const row = c as PettyCategory
    const ov = overrides[c.id]
    return ov ? { ...row, ...ov } : row
  })
  const [busyId, setBusyId] = useState<string | null>(null)

  const updatePetty = useApiMutation(
    (vars: { id: string; isPettyCash: boolean; pettyRefType: PettyRefType }) =>
      setCategoryPetty(vars.id, { isPettyCash: vars.isPettyCash, pettyRefType: vars.pettyRefType }),
    { invalidates: [queryKeys.settings.lookup('expense-categories')] }
  )

  async function save(cat: PettyCategory, isPettyCash: boolean, pettyRefType: PettyRefType) {
    setBusyId(cat.id)
    setOverrides((prev) => ({ ...prev, [cat.id]: { isPettyCash, pettyRefType } }))
    try {
      await updatePetty.mutateAsync({ id: cat.id, isPettyCash, pettyRefType })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setOverrides((prev) => {
        const next = { ...prev }
        delete next[cat.id]
        return next
      })
      setBusyId(null)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Petty cash categories</h2>
        <p className="text-sm text-muted-foreground">
          Turn a category on to enrol its expenses in petty cash. Pick what the expense form should
          ask for — a service provider (maintenance/repairs) or a staff member (errand).
        </p>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading categories…</p>
      ) : categories.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No expense categories yet. Create them in the Expenses area first.
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {categories.map((cat) => {
            const isPetty = !!cat.isPettyCash
            return (
              <div key={cat.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{cat.displayName || cat.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {isPetty
                      ? `Petty · ${REF_LABELS[cat.pettyRefType ?? 'none']}`
                      : 'Normal expense'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {isPetty && (
                    <Select
                      value={cat.pettyRefType ?? 'none'}
                      onValueChange={(v) => save(cat, true, v as PettyRefType)}
                      disabled={busyId === cat.id}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No reference</SelectItem>
                        <SelectItem value="service_provider">Service provider</SelectItem>
                        <SelectItem value="staff">Staff (errand)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Switch
                    checked={isPetty}
                    disabled={busyId === cat.id}
                    onCheckedChange={(on) =>
                      save(cat, on, on ? (cat.pettyRefType ?? 'none') : 'none')
                    }
                    aria-label={`Petty cash for ${cat.name}`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
