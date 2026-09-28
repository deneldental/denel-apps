import {
  DEFAULT_PETTY_CASH_POLICY,
  normalizePettyCashPolicy,
  type PettyCashPolicy,
} from '@denel/utils'
import { AlertCircle, Layers, Wallet } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { SettingsLoadError } from '@/features/settings/components/settings-load-error'
import { type PettyCategory, type PettyRefType, setCategoryPetty } from '@/lib/actions/petty-cash'
import { useApiMutation } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
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
import { useKvSetting } from '@/shared/hooks/use-kv-setting'
import { useLookup } from '@/shared/hooks/use-lookup'

const KV_KEY = 'finance:petty_cash'

const REF_LABELS: Record<PettyRefType, string> = {
  none: 'No reference',
  service_provider: 'Service provider',
  staff: 'Staff (errand)',
}

export function PettyCashPolicySection() {
  // KV policy form through the shared hook: seeded once the key loads, edits
  // stay local until Save, and a failed load blocks saving.
  const {
    value: form,
    setValue: setForm,
    loading,
    loadError,
    canSave,
    saving: savingPolicy,
    save: savePolicy,
    refetch,
  } = useKvSetting<PettyCashPolicy>(KV_KEY, DEFAULT_PETTY_CASH_POLICY, {
    fromStored: normalizePettyCashPolicy,
  })

  // Category enrollment: shared expense-categories lookup, refreshed when
  // Settings → Expense Categories (or this toggle) invalidates the key. A
  // local override map gives the switch instant feedback while the PATCH is
  // in flight, cleared once the mutation settles either way.
  const { rows: categoryRows, isLoading: categoriesLoading } = useLookup('expense-categories')
  const [overrides, setOverrides] = useState<
    Record<string, { isPettyCash: boolean; pettyRefType: PettyRefType }>
  >({})
  const categories: PettyCategory[] = categoryRows.map((c) => {
    const row = c as PettyCategory
    const ov = overrides[c.id]
    return ov ? { ...row, ...ov } : row
  })
  const [busyCategoryId, setBusyCategoryId] = useState<string | null>(null)

  const updatePetty = useApiMutation(
    (vars: { id: string; isPettyCash: boolean; pettyRefType: PettyRefType }) =>
      setCategoryPetty(vars.id, { isPettyCash: vars.isPettyCash, pettyRefType: vars.pettyRefType }),
    { invalidates: [queryKeys.settings.lookup('expense-categories')] }
  )

  async function handleSavePolicy() {
    try {
      await savePolicy()
      toast.success('Petty cash policy settings saved successfully')
    } catch {
      toast.error('Failed to save petty cash policy')
    }
  }

  async function saveCategoryEnrollment(
    cat: PettyCategory,
    isPettyCash: boolean,
    pettyRefType: PettyRefType
  ) {
    setBusyCategoryId(cat.id)
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
      setBusyCategoryId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <SettingsLoadError error={loadError} onRetry={refetch} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Petty Cash & Float Policies
          </CardTitle>
          <CardDescription>
            Amounts in cedis. Each one is used on the Petty Cash page and when a petty-cash expense
            is recorded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="default-float">Standard Box Float (Cedis)</Label>
              <Input
                id="default-float"
                type="number"
                min={0}
                value={form.defaultFloat}
                onChange={(e) => setForm({ ...form, defaultFloat: Number(e.target.value) || 0 })}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Stands in as the box balance until the first replenishment is recorded on the Petty
                Cash page.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="approval-limit">Single Disbursement Approval Threshold (Cedis)</Label>
              <Input
                id="approval-limit"
                type="number"
                min={0}
                value={form.singleApprovalLimit}
                onChange={(e) =>
                  setForm({ ...form, singleApprovalLimit: Number(e.target.value) || 0 })
                }
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Disbursements at or below this are confirmed automatically; above it they wait in
                the review list (badged "Over limit") for a manager to confirm or flag.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="replenish-warning">Low Float Replenishment Alert (Cedis)</Label>
              <Input
                id="replenish-warning"
                type="number"
                min={0}
                value={form.replenishWarningThreshold}
                onChange={(e) =>
                  setForm({ ...form, replenishWarningThreshold: Number(e.target.value) || 0 })
                }
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                The Petty Cash page shows a warning when the box balance (latest replenishment minus
                petty spend since) drops below this.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-ious">Max Active IOUs per Staff Member</Label>
              <Input
                id="max-ious"
                type="number"
                min={1}
                max={10}
                value={form.maxActiveIousPerStaff}
                onChange={(e) =>
                  setForm({ ...form, maxActiveIousPerStaff: Number(e.target.value) || 1 })
                }
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                A staff member with this many disbursements still awaiting review cannot receive
                another until one is confirmed or flagged.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <span>
              Money and ledger postings are never held: the limit decides what needs a manager's
              eyes, and flagged disbursements are excluded from the box balance.
            </span>
          </div>

          <div className="pt-2">
            <Button onClick={handleSavePolicy} disabled={!canSave || savingPolicy}>
              {savingPolicy ? 'Saving changes…' : 'Save petty cash policy'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Petty Cash Category Enrollment
          </CardTitle>
          <CardDescription>
            Turn a category on to enroll its expenses in petty cash. Select what the expense form
            should require — a service provider (maintenance/repairs) or a staff member (errand).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {categoriesLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading categories…</p>
          ) : categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No expense categories found. Configure categories in Expense Categories first.
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {categories.map((cat) => {
                const isPetty = !!cat.isPettyCash
                return (
                  <div key={cat.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{cat.displayName || cat.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {isPetty
                          ? `Petty Cash · ${REF_LABELS[cat.pettyRefType ?? 'none']}`
                          : 'Standard expense (non-petty)'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {isPetty && (
                        <Select
                          value={cat.pettyRefType ?? 'none'}
                          onValueChange={(v) =>
                            saveCategoryEnrollment(cat, true, v as PettyRefType)
                          }
                          disabled={busyCategoryId === cat.id}
                        >
                          <SelectTrigger className="w-44 h-8 text-xs">
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
                        disabled={busyCategoryId === cat.id}
                        onCheckedChange={(on) =>
                          saveCategoryEnrollment(
                            cat,
                            on,
                            on ? (cat.pettyRefType ?? 'none') : 'none'
                          )
                        }
                        aria-label={`Petty cash for ${cat.name}`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
