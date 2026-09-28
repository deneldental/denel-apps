import { ArrowLeft, Stethoscope } from 'lucide-react'
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
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { DEFAULT_PII_SCOPE, isPiiScope, type PiiScope, PiiScopeCard } from './pii-scope-card'

const SECTION = 'clinical'

const CONFIGS_KEY = queryKeys.injectionConfigs.list()

export default function ClinicalConfigPage() {
  const [enabled, setEnabled] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [includeAppointments, setIncludeAppointments] = useState(true)
  const [includeTreatments, setIncludeTreatments] = useState(true)
  const [piiScope, setPiiScope] = useState<PiiScope>(DEFAULT_PII_SCOPE)

  const configsQuery = useApiQuery(CONFIGS_KEY, () => getInjectionConfigs())
  const loading = configsQuery.isLoading

  useEffect(() => {
    if (!configsQuery.data) return
    const row = configsQuery.data.find((r) => r.section === SECTION)
    if (row) {
      setEnabled(row.enabled)
      const cfg = row.config as Record<string, unknown>
      setDateFrom((cfg.dateFrom as string) ?? '')
      setDateTo((cfg.dateTo as string) ?? '')
      setIncludeAppointments((cfg.includeAppointments as boolean) ?? true)
      setIncludeTreatments((cfg.includeTreatments as boolean) ?? true)
      setPiiScope(isPiiScope(cfg.piiScope) ? cfg.piiScope : DEFAULT_PII_SCOPE)
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
      await saveMutation.mutateAsync({
        enabled,
        config: {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          includeAppointments,
          includeTreatments,
          piiScope,
        },
      })
      toast.success('Clinical section updated')
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
          <Stethoscope className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Clinical</h1>
          <p className="text-sm text-muted-foreground">
            Configure which clinical records are visible in the reports app.
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
              aria-label="Toggle clinical section"
            />
          </div>
          <CardDescription>
            When enabled, clinical records matching the filters below are visible to reports app
            users.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Date Range</CardTitle>
          <CardDescription>Filter appointments and treatments by date.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="date-from">From</Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date-to">To</Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Data Types</CardTitle>
          <CardDescription>Select which clinical data to include.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Appointments</p>
              <p className="text-xs text-muted-foreground">
                Scheduled, completed, and cancelled appointments.
              </p>
            </div>
            <Switch
              checked={includeAppointments}
              onCheckedChange={setIncludeAppointments}
              aria-label="Include appointments"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Treatments &amp; Medical Records</p>
              <p className="text-xs text-muted-foreground">Treatment plans and clinical notes.</p>
            </div>
            <Switch
              checked={includeTreatments}
              onCheckedChange={setIncludeTreatments}
              aria-label="Include treatments"
            />
          </div>
        </CardContent>
      </Card>

      <PiiScopeCard value={piiScope} onChange={setPiiScope} />

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save & Publish'}
        </Button>
      </div>
    </div>
  )
}
