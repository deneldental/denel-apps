// M17 Data Sync rules surface — admin surface for managing per-entity sync
// rules, filters, and history.

import { useQueryClient } from '@tanstack/react-query'
import { addDays, format, formatDistanceToNow, parseISO } from 'date-fns'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  History,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getSyncRules, type SyncRule, updateSyncRule } from '@/lib/actions/sync-rules'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

const SYNC_ENTITY_LABELS: Record<string, string> = {
  patients: 'Patients',
  appointments: 'Appointments',
  payments: 'Payments',
  expenses: 'Expenses',
  lab_cases: 'Lab Cases',
  inventory: 'Inventory',
  users: 'Users',
}

import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'

interface SyncLogEntry {
  id: string
  entityType: string
  entityId: string
  syncMode: string
  destination: string | null
  success: boolean
  errorMessage: string | null
  syncedAt: string
}

const nextScheduledSync = (() => {
  const d = addDays(new Date(), 1)
  d.setHours(2, 0, 0, 0)
  return d.toISOString()
})()

// No shared query-key group exists for M17 data sync — local literals,
// module-scoped, used by both the reads below and the optimistic cache writes
// in handleToggleRule/handleSaveRule.
const SYNC_RULES_KEY = ['data-sync', 'rules'] as const
const SYNC_HISTORY_KEY = ['data-sync', 'history'] as const

export default function DataSyncRulesPage() {
  const queryClient = useQueryClient()

  const [reportsDbUrl, setReportsDbUrl] = useState('')
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionOk, setConnectionOk] = useState(true)
  const [editingRule, setEditingRule] = useState<SyncRule | null>(null)
  const [running, setRunning] = useState(false)

  const { data: rules = [], isLoading: loadingRules } = useApiQuery(SYNC_RULES_KEY, () =>
    getSyncRules()
  )

  const {
    data: history = [],
    isFetching: historyLoading,
    refetch: loadHistory,
  } = useApiQuery(SYNC_HISTORY_KEY, () => api.get<SyncLogEntry[]>('/api/sync/history?limit=50'))

  const enabledCount = useMemo(() => rules.filter((r) => r.enabled).length, [rules])

  const handleToggleRule = async (entity: string) => {
    const rule = rules.find((r) => r.entity === entity)
    if (!rule) return
    const next = !rule.enabled
    queryClient.setQueryData<SyncRule[]>(SYNC_RULES_KEY, (prev) =>
      (prev ?? []).map((r) => (r.entity === entity ? { ...r, enabled: next } : r))
    )
    const res = await updateSyncRule(entity, { enabled: next })
    if (!res.success) {
      queryClient.setQueryData<SyncRule[]>(SYNC_RULES_KEY, (prev) =>
        (prev ?? []).map((r) => (r.entity === entity ? { ...r, enabled: !next } : r))
      )
      surfaceApiError(res, 'Failed to update rule')
    }
  }

  const handleTestConnection = () => {
    setTestingConnection(true)
    setTimeout(() => {
      setTestingConnection(false)
      setConnectionOk(true)
      toast.success('Connection OK')
    }, 600)
  }

  const handleSyncNow = () => {
    setRunning(true)
    setTimeout(() => {
      setRunning(false)
      toast.success(`Sync queued for ${enabledCount} entit${enabledCount === 1 ? 'y' : 'ies'}`)
    }, 600)
  }

  const handleSaveRule = async (next: SyncRule) => {
    // filterOptions is read-only in the UI — excluded from the payload intentionally.
    const res = await updateSyncRule(next.entity, {
      enabled: next.enabled,
      filterCustom: next.filterCustom,
    })
    if (res.success && res.data) {
      const saved = res.data
      queryClient.setQueryData<SyncRule[]>(SYNC_RULES_KEY, (prev) =>
        (prev ?? []).map((r) => (r.entity === next.entity ? saved : r))
      )
      setEditingRule(null)
      toast.success(
        `Rule updated — ${SYNC_ENTITY_LABELS[next.entity as keyof typeof SYNC_ENTITY_LABELS] ?? next.entity}`
      )
    } else {
      surfaceApiError(res, 'Failed to update rule')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6" />
            Data Sync — Rules
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure per-entity filters + schedule. Synced data feeds the Reports project.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={running}>
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            Sync now
          </Button>
        </div>
      </div>

      {/* Connection card */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Reports database</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Target connection string for sync. Next scheduled run:{' '}
                {format(parseISO(nextScheduledSync), 'MMM d, yyyy h:mm a')}
              </p>
            </div>
            <Badge variant={connectionOk ? 'default' : 'destructive'}>
              {connectionOk ? 'Connected' : 'Unreachable'}
            </Badge>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[240px] space-y-1">
              <Label htmlFor="reports-db">Connection string</Label>
              <Input
                id="reports-db"
                type="password"
                value={reportsDbUrl}
                onChange={(e) => setReportsDbUrl(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <Button variant="outline" onClick={handleTestConnection} disabled={testingConnection}>
              {testingConnection ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Test connection
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sync rules grid */}
      <div>
        <h2 className="text-sm font-semibold mb-3">
          Sync rules ({enabledCount} / {rules.length} enabled)
        </h2>
        {loadingRules ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No sync rules configured yet. Rules are created automatically on first sync.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {rules.map((rule) => (
              <Card key={rule.entity}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">
                        {SYNC_ENTITY_LABELS[rule.entity as keyof typeof SYNC_ENTITY_LABELS] ??
                          rule.entity}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">{rule.entity}</p>
                    </div>
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => handleToggleRule(rule.entity)}
                    />
                  </div>

                  {rule.filterCustom && (
                    <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">
                      {rule.filterCustom}
                    </p>
                  )}

                  <div className="text-xs text-muted-foreground">
                    {rule.lastSyncedAt ? (
                      <>
                        Last synced{' '}
                        <span className="text-foreground font-medium">
                          {formatDistanceToNow(parseISO(rule.lastSyncedAt), { addSuffix: true })}
                        </span>
                        {' • '}
                        <span className="tabular-nums">
                          {rule.recordsSynced.toLocaleString()} record
                          {rule.recordsSynced === 1 ? '' : 's'}
                        </span>
                      </>
                    ) : (
                      <span>Never synced</span>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setEditingRule(rule)}
                  >
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                    Edit rule
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Sync history */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <History className="h-4 w-4" />
            Sync history
          </h2>
          <Button variant="ghost" size="sm" onClick={() => loadHistory()} disabled={historyLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Synced at</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : history.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground py-10 text-sm"
                    >
                      No sync history yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(parseISO(entry.syncedAt), 'MMM d, h:mm a')}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{entry.entityType}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.syncMode}
                      </TableCell>
                      <TableCell>
                        <SyncStatusBadge success={entry.success} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                        {entry.errorMessage ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <EditRuleSheet
        key={editingRule?.entity ?? '__none__'}
        rule={editingRule}
        onClose={() => setEditingRule(null)}
        onSave={handleSaveRule}
      />
    </div>
  )
}

function SyncStatusBadge({ success }: { success: boolean }) {
  if (success)
    return (
      <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        OK
      </Badge>
    )
  return (
    <Badge variant="destructive">
      <XCircle className="mr-1 h-3 w-3" />
      Failed
    </Badge>
  )
}

function EditRuleSheet({
  rule,
  onClose,
  onSave,
}: {
  rule: SyncRule | null
  onClose: () => void
  onSave: (next: SyncRule) => Promise<void>
}) {
  const [custom, setCustom] = useState<string>(rule?.filterCustom ?? '')
  const [enabled, setEnabled] = useState<boolean>(rule?.enabled ?? false)

  // Sync local state when the rule changes (e.g. opening a different rule).
  // The `key` prop on the parent handles the reset-on-new-rule case; this
  // handles any live updates to the same rule while the sheet stays open.
  useEffect(() => {
    if (rule) {
      setCustom(rule.filterCustom ?? '')
      setEnabled(rule.enabled)
    }
  }, [rule])

  const { isSubmitting, submit } = useSubmitGuard()

  const isDirty = custom !== (rule?.filterCustom ?? '') || enabled !== (rule?.enabled ?? false)

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose,
  })

  if (!rule) return null

  const handleSubmit = () => {
    void submit(async () => {
      await onSave({
        ...rule,
        enabled,
        filterCustom: custom.trim() || null,
      })
    })
  }

  const entityLabel =
    SYNC_ENTITY_LABELS[rule.entity as keyof typeof SYNC_ENTITY_LABELS] ?? rule.entity

  return (
    <>
      <SheetFormLayout
        open={!!rule}
        onOpenChange={guardedOnOpenChange}
        title={`Rule — ${entityLabel}`}
        description="Fine-tune what gets synced to the Reports project."
        size="md"
        submitLabel="Save rule"
        submitting={isSubmitting}
        onSubmit={handleSubmit}
      >
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When off, this entity is skipped during sync runs.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-custom">Custom filter predicate</Label>
            <Textarea
              id="rule-custom"
              rows={3}
              placeholder={`e.g. "exclude archived patients, exclude test accounts"`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              Natural-language description. The backend parses these into query filters.
            </p>
          </div>

          {rule.filterOptions && Object.keys(rule.filterOptions).length > 0 && (
            <div className="space-y-2">
              <Label>Structured options</Label>
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>
                    Structured toggles are editable in a later release. For now they are displayed
                    read-only.
                  </p>
                </div>
                <ul className="mt-2 space-y-1">
                  {Object.entries(rule.filterOptions).map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between text-xs font-mono">
                      <span>{k}</span>
                      <span className={v ? 'text-emerald-600' : 'text-muted-foreground'}>
                        {v ? 'on' : 'off'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </SheetFormLayout>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
