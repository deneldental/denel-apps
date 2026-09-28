import { BarChart3 } from 'lucide-react'
import { toast } from 'sonner'
import { SettingsLoadError } from '@/features/settings/components/settings-load-error'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { useKvSetting } from '@/shared/hooks/use-kv-setting'

const KV_KEY = 'monthly_threshold_config'
const DEFAULT_CONFIG = { enabled: false }

export function MonthlyThresholdSettingsSection() {
  const {
    value: { enabled },
    setValue,
    loading,
    loadError,
    canSave,
    saving,
    save,
    refetch,
  } = useKvSetting<{ enabled: boolean }>(KV_KEY, DEFAULT_CONFIG)

  const handleToggle = async (val: boolean) => {
    try {
      await save({ enabled: val })
      setValue({ enabled: val })
      toast.success(val ? 'Monthly Threshold enabled' : 'Monthly Threshold disabled')
    } catch {
      toast.error('Failed to update setting')
    }
  }

  return (
    <div className="space-y-4">
      <SettingsLoadError error={loadError} onRetry={refetch} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Monthly Threshold
          </CardTitle>
          <CardDescription>
            Track inventory items against monthly targets. When enabled, a Monthly Threshold section
            appears in the Inventory module for managing targets and reconciling usage at month-end.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Switch
              id="monthly-threshold-toggle"
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={!canSave || saving}
            />
            <Label htmlFor="monthly-threshold-toggle" className="cursor-pointer">
              {loading ? 'Loading…' : enabled ? 'Enabled' : 'Disabled'}
            </Label>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
