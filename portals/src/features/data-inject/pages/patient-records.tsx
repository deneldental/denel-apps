import { ArrowLeft, Users } from 'lucide-react'
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
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { DEFAULT_PII_SCOPE, isPiiScope, type PiiScope, PiiScopeCard } from './pii-scope-card'

const SECTION = 'patient_records'

const CATEGORIES = [
  { value: 'ongoing', label: 'Ongoing patients' },
  { value: 'one_time', label: 'One-time patients' },
  { value: 'ortho', label: 'Orthodontic patients' },
  { value: 'general', label: 'General patients' },
]

const CONFIGS_KEY = queryKeys.injectionConfigs.list()

export default function PatientRecordsConfigPage() {
  const [enabled, setEnabled] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [limit, setLimit] = useState<number>(500)
  const [piiScope, setPiiScope] = useState<PiiScope>(DEFAULT_PII_SCOPE)

  const configsQuery = useApiQuery(CONFIGS_KEY, () => getInjectionConfigs())
  const loading = configsQuery.isLoading

  useEffect(() => {
    if (!configsQuery.data) return
    const row = configsQuery.data.find((r) => r.section === SECTION)
    if (row) {
      setEnabled(row.enabled)
      const cfg = row.config as Record<string, unknown>
      setCategories((cfg.categories as string[]) ?? [])
      setDateFrom((cfg.dateFrom as string) ?? '')
      setDateTo((cfg.dateTo as string) ?? '')
      setLimit((cfg.limit as number) ?? 500)
      setPiiScope(isPiiScope(cfg.piiScope) ? cfg.piiScope : DEFAULT_PII_SCOPE)
    }
  }, [configsQuery.data])

  function toggleCategory(value: string) {
    setCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    )
  }

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
          categories: categories.length > 0 ? categories : undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          limit,
          piiScope,
        },
      })
      toast.success('Patient Records section updated')
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
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Patient Records</h1>
          <p className="text-sm text-muted-foreground">
            Configure which patient records are visible in the reports app.
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
              aria-label="Toggle patient records section"
            />
          </div>
          <CardDescription>
            When enabled, patient records matching the filters below are visible to reports app
            users.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Patient Categories</CardTitle>
          <CardDescription>
            Leave all unchecked to include patients from every category.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((cat) => (
            <div key={cat.value} className="flex items-center gap-2">
              <Checkbox
                id={`cat-${cat.value}`}
                checked={categories.includes(cat.value)}
                onCheckedChange={() => toggleCategory(cat.value)}
              />
              <Label htmlFor={`cat-${cat.value}`} className="font-normal cursor-pointer">
                {cat.label}
              </Label>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Date Range</CardTitle>
          <CardDescription>Filter by the patient's first visit date.</CardDescription>
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
          <CardTitle className="text-base">Record Limit</CardTitle>
          <CardDescription>Maximum number of patient records to expose.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 max-w-[160px]">
            <Label htmlFor="limit">Limit</Label>
            <Input
              id="limit"
              type="number"
              min={1}
              max={10000}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
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
