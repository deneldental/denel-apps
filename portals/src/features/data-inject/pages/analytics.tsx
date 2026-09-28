import { ArrowLeft, BarChart2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { getInjectionConfigs, updateInjectionSection } from '@/lib/actions/reports-injection'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Switch } from '@/shared/components/ui/switch'

const SECTION = 'analytics'

type TrendPeriod = 'week' | 'month' | 'quarter'

const CONFIGS_KEY = queryKeys.injectionConfigs.list()

export default function AnalyticsConfigPage() {
  const [enabled, setEnabled] = useState(false)
  const [kpiEnabled, setKpiEnabled] = useState(true)
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('month')

  const configsQuery = useApiQuery(CONFIGS_KEY, () => getInjectionConfigs())
  const loading = configsQuery.isLoading

  useEffect(() => {
    if (!configsQuery.data) return
    const row = configsQuery.data.find((r) => r.section === SECTION)
    if (row) {
      setEnabled(row.enabled)
      const cfg = row.config as Record<string, unknown>
      setKpiEnabled((cfg.kpiEnabled as boolean) ?? true)
      setTrendPeriod((cfg.trendPeriod as TrendPeriod) ?? 'month')
    }
  }, [configsQuery.data])

  const saveMutation = useApiMutation(
    (payload: { enabled: boolean; config: Record<string, unknown> }) =>
      updateInjectionSection(SECTION, payload),
    { invalidates: [CONFIGS_KEY] }
  )
  const saving = saveMutation.isPending

  async function handleSave() {
    try {
      await saveMutation.mutateAsync({ enabled, config: { kpiEnabled, trendPeriod } })
      toast.success('Analytics section updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading…</div>
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/data-inject">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <BarChart2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Configure which KPI dashboards and trend charts are visible in the reports app.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Publish this section</CardTitle>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Toggle analytics section"
            />
          </div>
          <CardDescription>
            When enabled, analytics dashboards matching the settings below are visible to reports
            app users.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Display Options</CardTitle>
          <CardDescription>Control what analytics content is shown.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">KPI Summary</p>
              <p className="text-xs text-muted-foreground">
                Revenue, patient volume, and collection rate tiles.
              </p>
            </div>
            <Switch
              checked={kpiEnabled}
              onCheckedChange={setKpiEnabled}
              aria-label="Enable KPI summary"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Trend Period</CardTitle>
          <CardDescription>Default time range shown for trend charts.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 max-w-[200px]">
            <Label htmlFor="trend-period">Period</Label>
            <Select value={trendPeriod} onValueChange={(v) => setTrendPeriod(v as TrendPeriod)}>
              <SelectTrigger id="trend-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Last 7 days</SelectItem>
                <SelectItem value="month">Last 30 days</SelectItem>
                <SelectItem value="quarter">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save & Publish'}
        </Button>
      </div>
    </div>
  )
}
