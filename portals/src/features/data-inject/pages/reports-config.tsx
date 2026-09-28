import { ArrowLeft, FileText } from 'lucide-react'
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
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'

const SECTION = 'reports'

const AVAILABLE_REPORTS = [
  { value: 'pl', label: 'Profit & Loss' },
  { value: 'bs', label: 'Balance Sheet' },
  { value: 'cf', label: 'Cash Flow' },
  { value: 'cash_pos', label: 'Cash Position' },
  { value: 'revenue_category', label: 'Revenue by Category' },
  { value: 'revenue_provider', label: 'Revenue by Provider' },
  { value: 'deferred_revenue', label: 'Deferred Revenue' },
  { value: 'ap_aging', label: 'AP Aging' },
  { value: 'discounts', label: 'Discounts Report' },
  { value: 'specialist_commissions', label: 'Specialist Commissions' },
  { value: 'financial_records', label: 'Financial Records (GL)' },
  { value: 'tax_calculations', label: 'Tax Calculations' },
]

const CONFIGS_KEY = queryKeys.injectionConfigs.list()

export default function ReportsConfigPage() {
  const [enabled, setEnabled] = useState(false)
  const [enabledReports, setEnabledReports] = useState<string[]>([])

  const configsQuery = useApiQuery(CONFIGS_KEY, () => getInjectionConfigs())
  const loading = configsQuery.isLoading

  useEffect(() => {
    if (!configsQuery.data) return
    const row = configsQuery.data.find((r) => r.section === SECTION)
    if (row) {
      setEnabled(row.enabled)
      const cfg = row.config as Record<string, unknown>
      setEnabledReports((cfg.enabledReports as string[]) ?? AVAILABLE_REPORTS.map((r) => r.value))
    } else {
      setEnabledReports(AVAILABLE_REPORTS.map((r) => r.value))
    }
  }, [configsQuery.data])

  function toggleReport(value: string) {
    setEnabledReports((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]
    )
  }

  function selectAll() {
    setEnabledReports(AVAILABLE_REPORTS.map((r) => r.value))
  }

  function clearAll() {
    setEnabledReports([])
  }

  const saveMutation = useApiMutation(
    (payload: { enabled: boolean; config: Record<string, unknown> }) =>
      updateInjectionSection(SECTION, payload),
    { invalidates: [CONFIGS_KEY] }
  )
  const saving = saveMutation.isPending

  async function handleSave() {
    try {
      await saveMutation.mutateAsync({ enabled, config: { enabledReports } })
      toast.success('Reports section updated')
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
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Choose which financial statements are visible in the reports app.
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
              aria-label="Toggle reports section"
            />
          </div>
          <CardDescription>
            When enabled, only the selected reports below are visible to reports app users.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Available Reports</CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={selectAll}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearAll}>
                Clear
              </Button>
            </div>
          </div>
          <CardDescription>
            {enabledReports.length} of {AVAILABLE_REPORTS.length} reports selected.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {AVAILABLE_REPORTS.map((report) => (
            <div key={report.value} className="flex items-center gap-2">
              <Checkbox
                id={`report-${report.value}`}
                checked={enabledReports.includes(report.value)}
                onCheckedChange={() => toggleReport(report.value)}
              />
              <Label
                htmlFor={`report-${report.value}`}
                className="font-normal cursor-pointer text-sm"
              >
                {report.label}
              </Label>
            </div>
          ))}
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
