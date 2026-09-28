import { AlertTriangle, Boxes } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DEFAULT_INVENTORY_POLICIES, type InventoryPolicies } from '@/features/inventory/policies'
import { SettingsLoadError } from '@/features/settings/components/settings-load-error'
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
import { useKvSetting } from '@/shared/hooks/use-kv-setting'

const KV_KEY = 'inventory:policies'

export function InventoryPoliciesSection() {
  const {
    value: form,
    setValue: setForm,
    loaded,
    loading,
    loadError,
    canSave,
    saving,
    save,
    refetch,
  } = useKvSetting<InventoryPolicies>(KV_KEY, DEFAULT_INVENTORY_POLICIES)
  // The comma-separated text is seeded from the LOADED value, not the draft,
  // so typing in it never fights the draft.
  const [reasonsText, setReasonsText] = useState(
    DEFAULT_INVENTORY_POLICIES.adjustmentReasons.join(', ')
  )
  useEffect(() => {
    if (loaded) setReasonsText(loaded.adjustmentReasons.join(', '))
  }, [loaded])

  async function handleSave() {
    const reasons = reasonsText
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
    const payload: InventoryPolicies = {
      ...form,
      adjustmentReasons:
        reasons.length > 0 ? reasons : DEFAULT_INVENTORY_POLICIES.adjustmentReasons,
    }
    try {
      await save(payload)
      toast.success('Inventory policies saved successfully')
    } catch {
      toast.error('Failed to save inventory policies')
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <SettingsLoadError error={loadError} onRetry={refetch} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" />
            Inventory & Store Operational Policies
          </CardTitle>
          <CardDescription>
            Expiry windows for the Inventory page, the valuation method behind stock values and
            receipts, and the reason codes offered when adjusting stock.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="expiry-warning">Early Expiry Warning Window (Days)</Label>
              <Input
                id="expiry-warning"
                type="number"
                min={15}
                max={365}
                value={form.expiryWarningDays}
                onChange={(e) =>
                  setForm({ ...form, expiryWarningDays: Number(e.target.value) || 90 })
                }
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Batches expiring within this many days are listed on the Inventory page's Expiring
                soon tab.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="critical-expiry">Critical Expiry Urgent Alert (Days)</Label>
              <Input
                id="critical-expiry"
                type="number"
                min={1}
                max={90}
                value={form.criticalExpiryDays}
                onChange={(e) =>
                  setForm({ ...form, criticalExpiryDays: Number(e.target.value) || 30 })
                }
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Batches this close to expiry are highlighted in red and turn the tab's count red.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="valuation-method">Costing & Valuation Model</Label>
              <Select
                value={form.valuationMethod}
                onValueChange={(v: any) => setForm({ ...form, valuationMethod: v })}
                disabled={loading}
              >
                <SelectTrigger id="valuation-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fifo">FIFO (First-In, First-Out)</SelectItem>
                  <SelectItem value="weighted_average">Weighted Average Cost (AVCO)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                FIFO values remaining batches at their receipt cost. Weighted average keeps a
                running average cost on each item as stock is received; cost of goods sold follows
                the same rule. Shown as the stock value on the Inventory page and on each item.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adjustment-reasons">Stock Adjustment Reason Codes</Label>
              <Input
                id="adjustment-reasons"
                value={reasonsText}
                onChange={(e) => setReasonsText(e.target.value)}
                placeholder="Count Variance, Expired, Damaged"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated reasons offered in the Adjust stock form; "Other" with a note is
                always available.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <span>
              Per-item minimum reorder thresholds can also be configured directly in the Store item
              detail sheets.
            </span>
          </div>

          <div className="pt-2">
            <Button onClick={handleSave} disabled={!canSave || saving}>
              {saving ? 'Saving changes…' : 'Save inventory policies'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
