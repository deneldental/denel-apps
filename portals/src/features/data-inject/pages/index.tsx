import {
  BarChart2,
  Database,
  Download,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Loader2,
  Settings,
  Stethoscope,
  Upload,
  Users,
} from 'lucide-react'
import { type ComponentType, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ImportReport } from '@/features/settings/components/import-report'
import {
  downloadCsv,
  exportTableData,
  getImportableTables,
  getManageableTables,
  getTableTemplate,
  type ImportResult,
  importTableData,
  rowsToCsv,
} from '@/lib/actions/database'
import { getInjectionConfigs, updateInjectionSection } from '@/lib/actions/reports-injection'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Switch } from '@/shared/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'

type SectionMeta = {
  section: string
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  configHref: string | null
}

const SECTIONS: SectionMeta[] = [
  {
    section: 'overview',
    label: 'Overview',
    description: 'Summary KPIs and injection status dashboard shown to reports app viewers.',
    icon: LayoutDashboard,
    configHref: null,
  },
  {
    section: 'patient_records',
    label: 'Patient Records',
    description: 'Patient demographics and visit summaries. Filter by category and date range.',
    icon: Users,
    configHref: '/data-inject/patient-records',
  },
  {
    section: 'clinical',
    label: 'Clinical',
    description: 'Appointments and treatment records. Filter by date range and data type.',
    icon: Stethoscope,
    configHref: '/data-inject/clinical',
  },
  {
    section: 'finance',
    label: 'Finance',
    description: 'Payments, expenses, and payroll data. Filter by period.',
    icon: Upload,
    configHref: '/data-inject/finance',
  },
  {
    section: 'reports',
    label: 'Reports',
    description: 'Financial statements: P&L, Balance Sheet, Cash Flow, and more.',
    icon: FileText,
    configHref: '/data-inject/reports-config',
  },
  {
    section: 'analytics',
    label: 'Analytics',
    description: 'KPI dashboards and trend charts for the reports app.',
    icon: BarChart2,
    configHref: '/data-inject/analytics',
  },
  {
    section: 'settings',
    label: 'Settings',
    description: 'Audit logs and application settings visible to reports app users.',
    icon: Settings,
    configHref: null,
  },
]

function formatUpdatedAt(iso: string | undefined): string {
  if (!iso) return 'Never published'
  return new Date(iso).toLocaleString()
}

export default function DataInjectPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Data Inject</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Publish data to the reports app and run manual CSV imports / exports.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a
            href={import.meta.env.VITE_REPORTS_URL ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Reports App
          </a>
        </Button>
      </div>

      <Tabs defaultValue="menu" className="space-y-4">
        <TabsList>
          <TabsTrigger value="menu">Menu</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="menu" className="space-y-4">
          <MenuTab />
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          <DataTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Menu tab — the original section publishing UI ────────────────────────────

const CONFIGS_KEY = queryKeys.injectionConfigs.list()

function MenuTab() {
  const [toggling, setToggling] = useState<string | null>(null)

  const configsQuery = useApiQuery(CONFIGS_KEY, () => getInjectionConfigs())
  const rows = configsQuery.data ?? []
  const loading = configsQuery.isLoading

  const toggleMutation = useApiMutation(
    (vars: { section: string; enabled: boolean }) =>
      updateInjectionSection(vars.section, { enabled: vars.enabled }),
    { invalidates: [CONFIGS_KEY] }
  )

  async function handleToggle(section: string, currentEnabled: boolean) {
    setToggling(section)
    try {
      await toggleMutation.mutateAsync({ section, enabled: !currentEnabled })
      toast.success(`${section.replace('_', ' ')} ${!currentEnabled ? 'published' : 'unpublished'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update section')
    } finally {
      setToggling(null)
    }
  }

  const rowMap = Object.fromEntries(rows.map((r) => [r.section, r]))

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((s) => (
          <Card key={s.section} className="animate-pulse">
            <CardContent className="p-6 h-36" />
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {SECTIONS.map((meta) => {
        const row = rowMap[meta.section]
        const enabled = row?.enabled ?? false
        const Icon = meta.icon

        return (
          <Card
            key={meta.section}
            className={`transition-colors h-full flex flex-col ${
              enabled ? 'border-green-200 bg-green-50/30' : ''
            }`}
          >
            <CardContent className="p-5 flex flex-col gap-3 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm leading-tight">{meta.label}</p>
                    <Badge
                      variant="outline"
                      className={`text-[10px] mt-0.5 ${
                        enabled
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-gray-50 text-gray-500 border-gray-200'
                      }`}
                    >
                      {enabled ? 'Published' : 'Not Published'}
                    </Badge>
                  </div>
                </div>
                <Switch
                  checked={enabled}
                  disabled={toggling === meta.section}
                  onCheckedChange={() => handleToggle(meta.section, enabled)}
                  aria-label={`Toggle ${meta.label}`}
                />
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                {meta.description}
              </p>

              <div className="flex items-center justify-between gap-2 pt-1 border-t">
                <p className="text-[10px] text-muted-foreground truncate">
                  {row ? formatUpdatedAt(row.updatedAt) : '—'}
                </p>
                {meta.configHref && (
                  <Button size="sm" variant="outline" asChild className="h-7 text-xs shrink-0">
                    <Link to={meta.configHref}>Configure</Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Data tab — manual CSV import + table export ──────────────────────────────

function humanizeTableName(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function DataTab() {
  const tablesQuery = useApiQuery<string[]>(queryKeys.database.manageableTables(), () =>
    getManageableTables()
  )
  const tables = tablesQuery.data ?? []
  const importableQuery = useApiQuery<string[]>(queryKeys.database.importableTables(), () =>
    getImportableTables()
  )
  const importable = importableQuery.data ?? []
  const loadingTables = tablesQuery.isLoading || importableQuery.isLoading

  if (loadingTables) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading tables…
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ImportSection tables={importable} />
      <ExportSection tables={tables} />
    </div>
  )
}

// ─── Import ───────────────────────────────────────────────────────────────────

export function ImportSection({ tables }: { tables: string[] }) {
  const [target, setTarget] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<'idle' | 'template' | 'import'>('idle')
  const [report, setReport] = useState<ImportResult | null>(null)

  async function handleDownloadTemplate() {
    if (!target) return
    setBusy('template')
    try {
      const res = await getTableTemplate(target)
      if (!res.success || !res.data) {
        toast.error(res.error ?? 'Failed to fetch template')
        return
      }
      downloadCsv(`${target}-template.csv`, res.data)
      toast.success('Template downloaded')
    } finally {
      setBusy('idle')
    }
  }

  async function handleImport() {
    if (!target || !file) return
    setBusy('import')
    try {
      const text = await file.text()
      const res = await importTableData(target, text)
      setReport(res.success || res.skipped?.length ? res : null)
      if (res.success) {
        toast.success(`Imported ${res.count ?? 0} rows into ${humanizeTableName(target)}`)
        setFile(null)
        const input = document.getElementById('csv-import-input') as HTMLInputElement | null
        if (input) input.value = ''
      } else {
        toast.error(res.error ?? 'Import failed')
      }
    } finally {
      setBusy('idle')
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <Upload className="h-4 w-4" />
          </div>
          <div>
            <p className="font-semibold text-sm">Import CSV</p>
            <p className="text-xs text-muted-foreground">
              Bulk-load rows into a lookup table. Download the template first to match the schema.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Target table</p>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a table…" />
            </SelectTrigger>
            <SelectContent>
              {tables.map((t) => (
                <SelectItem key={t} value={t}>
                  {humanizeTableName(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">CSV file</p>
          <input
            id="csv-import-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/80"
          />
          {file && (
            <p className="text-[11px] text-muted-foreground">
              {file.name} · {Math.round(file.size / 1024)} KB
            </p>
          )}
        </div>

        {report && <ImportReport result={report} />}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadTemplate}
            disabled={!target || busy !== 'idle'}
          >
            {busy === 'template' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Download template
          </Button>
          <Button size="sm" onClick={handleImport} disabled={!target || !file || busy !== 'idle'}>
            {busy === 'import' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Upload className="h-3.5 w-3.5 mr-1.5" />
            )}
            Import
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Export ───────────────────────────────────────────────────────────────────

function ExportSection({ tables }: { tables: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)

  const allSelected = selected.size === tables.length && tables.length > 0

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => (prev.size === tables.length ? new Set() : new Set(tables)))
  }

  async function handleExport() {
    if (selected.size === 0) return
    setBusy(true)
    setProgress(null)
    const ordered = tables.filter((t) => selected.has(t))
    const failures: string[] = []

    try {
      for (let i = 0; i < ordered.length; i++) {
        const tableName = ordered[i]
        setProgress(`Exporting ${humanizeTableName(tableName)} (${i + 1}/${ordered.length})…`)
        const res = await exportTableData(tableName)
        if (!res.success || !Array.isArray(res.data)) {
          failures.push(tableName)
          continue
        }
        const csv = rowsToCsv(res.data)
        if (!csv) {
          // Empty table — skip the download but keep going.
          continue
        }
        const stamp = new Date().toISOString().slice(0, 10)
        downloadCsv(`${tableName}-${stamp}.csv`, csv)
      }
      if (failures.length === 0) {
        toast.success(`Exported ${ordered.length - failures.length} table(s)`)
      } else {
        toast.warning(
          `Exported ${ordered.length - failures.length}; failed: ${failures.join(', ')}`
        )
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const grouped = useMemo(() => groupTables(tables), [tables])

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <p className="font-semibold text-sm">Export from database</p>
            <p className="text-xs text-muted-foreground">
              Pick one or more tables to download as CSV files.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pb-1 border-b">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              aria-label="Select all tables"
            />
            Select all ({selected.size}/{tables.length})
          </label>
          {progress && <p className="text-[11px] text-muted-foreground">{progress}</p>}
        </div>

        <div className="max-h-[380px] overflow-y-auto space-y-3 pr-1">
          {grouped.map(({ group, items }) => (
            <div key={group}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                {group}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {items.map((t) => (
                  <label
                    key={t}
                    className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.has(t)}
                      onCheckedChange={() => toggle(t)}
                      aria-label={t}
                    />
                    <span>{humanizeTableName(t)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2">
          <Button onClick={handleExport} disabled={selected.size === 0 || busy} className="w-full">
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            {busy
              ? 'Exporting…'
              : `Export ${selected.size || ''} table${selected.size === 1 ? '' : 's'}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// Light grouping so the export list scans quicker. Anything that doesn't match
// a known group falls into "Other".
function groupTables(tables: string[]): { group: string; items: string[] }[] {
  const GROUPS: { group: string; match: (t: string) => boolean }[] = [
    {
      group: 'Patients',
      match: (t) =>
        t.startsWith('patient') ||
        t === 'medical_records' ||
        t === 'pending_medical_records' ||
        t === 'doctors' ||
        t === 'doctor_unavailability' ||
        t === 'appointments' ||
        t === 'ortho_consent_forms',
    },
    {
      group: 'Finance',
      match: (t) =>
        [
          'payments',
          'payment_plans',
          'payment_plan_templates',
          'payment_methods',
          'expenses',
          'expense_categories',
          'sales',
          'daily_reports',
        ].includes(t),
    },
    {
      group: 'Inventory',
      match: (t) => ['inventory', 'products', 'units', 'categories'].includes(t),
    },
    { group: 'Lookups', match: (t) => ['treatment_types', 'appointment_types'].includes(t) },
    { group: 'Communications', match: (t) => ['sms_messages', 'messages'].includes(t) },
  ]

  const buckets: Record<string, string[]> = {}
  const used = new Set<string>()

  for (const g of GROUPS) {
    const items = tables.filter((t) => g.match(t))
    if (items.length) buckets[g.group] = items
    for (const t of items) used.add(t)
  }
  const other = tables.filter((t) => !used.has(t))
  if (other.length) buckets.Other = other

  return Object.entries(buckets).map(([group, items]) => ({ group, items: items.sort() }))
}
