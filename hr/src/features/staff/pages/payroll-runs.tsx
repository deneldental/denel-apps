import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@denel/ui'
import { formatCurrency } from '@denel/utils'
import { format, parseISO } from 'date-fns'
import {
  AlertTriangle,
  CalendarRange,
  Coins,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PayrollRunLedger } from '@/features/staff/components/payroll-run-ledger'
import {
  createPayrollRun,
  deletePayrollRun,
  getPayrollRunDetails,
  getPayrollRuns,
  type PayrollRun,
  type PayrollRunDetailRow,
  publishPayrollRun,
  rerunPayrollRun,
} from '@/lib/actions/hr-phase2-4'
import { ACTIONS, MODULES } from '@/lib/modules'
import { EmptyState } from '@/shared/components/empty-state'
import { StatusBadge } from '@/shared/components/status-badge'
import { useConfirm } from '@/shared/hooks/use-confirm'
import { usePermissions } from '@/shared/hooks/use-permissions'

function ghs(value: string | null): string {
  if (value == null) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  return formatCurrency(n)
}

function formatDate(input: string | null | undefined): string {
  if (!input) return '—'
  try {
    return format(parseISO(input), 'MMM d, yyyy')
  } catch {
    return input
  }
}

function num(value: string | null): number {
  if (value == null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * PR-8 — find the most recently published run whose period started before
 * `target`. Used by the publish-preview dialog to compute variance against
 * the last shipped payroll, so HR can spot anomalies before locking in.
 */
function findPriorPublishedRun(target: PayrollRun, all: PayrollRun[]): PayrollRun | null {
  const targetStart = new Date(target.payPeriodStart).getTime()
  return (
    all
      .filter(
        (r) =>
          r.id !== target.id &&
          r.status === 'published' &&
          new Date(r.payPeriodStart).getTime() < targetStart
      )
      .sort(
        (a, b) => new Date(b.payPeriodStart).getTime() - new Date(a.payPeriodStart).getTime()
      )[0] ?? null
  )
}

export default function PayrollRunsPage() {
  // HR-M9: hide money actions the viewer can't perform (backend also enforces).
  const { hasPermission } = usePermissions()
  const { confirm, confirmDialog } = useConfirm()
  const canCreateRun = hasPermission(MODULES.PAYROLL as string, ACTIONS.CREATE as string)
  const canPublishRun = hasPermission(MODULES.PAYROLL as string, ACTIONS.UPDATE as string)
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', start: '', end: '' })
  const [publishingId, setPublishingId] = useState<string | null>(null)
  // PR-8 — publish requires an explicit confirmation step that shows variance
  // from the prior published run. Setting this opens the preview dialog.
  const [previewTarget, setPreviewTarget] = useState<PayrollRun | null>(null)
  const [ledgerRun, setLedgerRun] = useState<PayrollRun | null>(null)
  const [ledgerRows, setLedgerRows] = useState<PayrollRunDetailRow[]>([])
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [ledgerLoading, setLedgerLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getPayrollRuns()
    setLoading(false)
    if (res.success && Array.isArray(res.data)) {
      setRuns(res.data)
    } else {
      toast.error(res.error || 'Failed to load pay runs')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate() {
    if (!form.name || !form.start || !form.end) {
      toast.error('Name, start, and end dates are required.')
      return
    }
    setCreating(true)
    const res = await createPayrollRun({
      name: form.name,
      payPeriodStart: form.start,
      payPeriodEnd: form.end,
    })
    setCreating(false)
    if (!res.success || !res.data) {
      toast.error(res.error || 'Failed to create pay run')
      return
    }
    toast.success(
      `Drafted ${res.data.staffCount} payslips · gross ${ghs(String(res.data.totalGross))}.`
    )
    setDialogOpen(false)
    setForm({ name: '', start: '', end: '' })
    await load()
  }

  function openPublishPreview(run: PayrollRun) {
    if (run.status === 'published') return
    setPreviewTarget(run)
  }

  async function confirmPublish() {
    if (!previewTarget) return
    setPublishingId(previewTarget.id)
    const res = await publishPayrollRun(previewTarget.id)
    setPublishingId(null)
    if (!res.success) {
      toast.error(res.error || 'Failed to publish pay run')
      return
    }
    toast.success(`${previewTarget.name} published.`)
    // HR-H2: the pay-period month was closed, so the GL entry was re-dated into
    // the current open period as a prior-period adjustment — make that visible.
    if (res.data?.glRedated) {
      toast.warning(
        `GL posted as a prior-period adjustment dated ${res.data.glPostedDate ?? 'today'} — the pay-period month was closed.`,
        { duration: 8000 }
      )
    }
    setPreviewTarget(null)
    await load()
  }

  async function handleRerun(run: PayrollRun) {
    const ok = await confirm({
      title: 'Recalculate pay run',
      description: `This recalculates and overwrites the payslips for "${run.name}".`,
      confirmLabel: 'Recalculate',
      tone: 'default',
    })
    if (!ok) return
    setPublishingId(run.id)
    try {
      const res = await rerunPayrollRun(run.id)
      if (res.success) {
        toast.success(`${run.name} recalculated successfully.`)
        await load()
      } else {
        toast.error(res.error || 'Failed to rerun payroll')
      }
    } finally {
      setPublishingId(null)
    }
  }

  async function handleDelete(run: PayrollRun) {
    const ok = await confirm({
      title: 'Delete draft pay run',
      description: 'This permanently deletes the draft run and its payslips.',
      itemName: run.name,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    setPublishingId(run.id)
    const res = await deletePayrollRun(run.id)
    setPublishingId(null)
    if (!res.success) {
      toast.error(res.error || 'Failed to delete pay run')
      return
    }
    toast.success(`${run.name} deleted.`)
    await load()
  }

  async function openLedger(run: PayrollRun) {
    setLedgerRun(run)
    setLedgerRows([])
    setLedgerOpen(true)
    setLedgerLoading(true)
    const res = await getPayrollRunDetails(run.id)
    setLedgerLoading(false)
    if (res.success && res.data) {
      setLedgerRun(res.data.run)
      setLedgerRows(res.data.rows)
    } else {
      toast.error(res.error || 'Failed to load pay run details')
      setLedgerOpen(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payroll runs</h1>
          <p className="mt-1 text-muted-foreground">
            Draft a pay run, review variance, then publish. PAYE + SSNIT computed automatically from
            each staff member's salary components.
          </p>
        </div>
        {canCreateRun && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New pay run
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Coins className="h-5 w-5" />
            All runs
          </CardTitle>
          <CardDescription>
            Drafts stay editable; publishing locks payslips for the period.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={Coins}
              title="No pay runs yet"
              description="A pay run drafts one payslip per active staff using their salary components. PAYE and SSNIT are computed automatically. Nothing gets published until you confirm."
              action={{ label: 'Draft your first run', onClick: () => setDialogOpen(true) }}
            />
          ) : (
            <ul className="divide-y divide-border">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="grid grid-cols-1 gap-3 py-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto] md:items-center"
                >
                  <div>
                    <p className="text-sm font-medium">{run.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <CalendarRange className="mr-1 inline h-3 w-3" />
                      {formatDate(run.payPeriodStart)} – {formatDate(run.payPeriodEnd)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Staff
                    </p>
                    <p className="text-sm tabular-nums">{run.staffCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Gross / Net
                    </p>
                    <p className="text-sm tabular-nums">{ghs(run.totalGross)}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {ghs(run.totalNet)} net
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      PAYE / SSNIT
                    </p>
                    <p className="text-sm tabular-nums">{ghs(run.totalPaye)}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {ghs(run.totalSsnit)} ssnit
                    </p>
                  </div>
                  <div className="flex items-center gap-2 md:justify-end">
                    <StatusBadge status={run.status} />

                    <Button size="sm" variant="outline" onClick={() => openLedger(run)}>
                      <FileText className="mr-1 h-3 w-3" /> View breakdown
                    </Button>

                    {run.status === 'draft' && canPublishRun && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openPublishPreview(run)}
                        disabled={publishingId === run.id}
                      >
                        <ShieldCheck className="mr-1 h-3 w-3" /> Review &amp; publish
                      </Button>
                    )}

                    {run.status === 'draft' && canCreateRun && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRerun(run)}
                        disabled={publishingId === run.id}
                        title="Recalculate run"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}

                    {run.status === 'draft' && canCreateRun && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(run)}
                        disabled={publishingId === run.id}
                        title="Delete draft run"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New pay run</DialogTitle>
            <DialogDescription>
              Drafts a payslip per active staff using their salary components. Nothing is published
              until you confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="run-name">Name</Label>
              <Input
                id="run-name"
                placeholder="e.g. May 2026 Payroll"
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="run-start">Period start</Label>
                <Input
                  id="run-start"
                  type="date"
                  value={form.start}
                  onChange={(e) => setForm((s) => ({ ...s, start: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="run-end">Period end</Label>
                <Input
                  id="run-end"
                  type="date"
                  value={form.end}
                  onChange={(e) => setForm((s) => ({ ...s, end: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Drafting…
                </>
              ) : (
                'Draft pay run'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ledgerOpen} onOpenChange={setLedgerOpen}>
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-[1400px] flex-col gap-0 overflow-hidden p-0">
          <div className="min-h-0 flex-1 overflow-auto p-6">
            {ledgerRun ? (
              <PayrollRunLedger run={ledgerRun} rows={ledgerRows} loading={ledgerLoading} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <PublishPreviewDialog
        target={previewTarget}
        prior={previewTarget ? findPriorPublishedRun(previewTarget, runs) : null}
        onCancel={() => setPreviewTarget(null)}
        onConfirm={confirmPublish}
        submitting={publishingId === previewTarget?.id}
      />

      {confirmDialog}
    </div>
  )
}

// ── Publish preview dialog (PR-8) ──────────────────────────────────────────
//
// Inserts a confirmation step between "click Publish on a draft" and the
// actual publish call. The dialog shows the run's totals alongside the
// prior published run for the same payroll cadence, with deltas highlighted.
// Variance >10% on any axis is flagged for explicit attention.

function PublishPreviewDialog({
  target,
  prior,
  onCancel,
  onConfirm,
  submitting,
}: {
  target: PayrollRun | null
  prior: PayrollRun | null
  onCancel: () => void
  onConfirm: () => void
  submitting: boolean
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && !submitting && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Publish {target?.name}
          </DialogTitle>
          <DialogDescription>
            Once published, payslips are visible to staff on the PWA and the run is locked. Review
            the totals — especially any variance from last month — before confirming.
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="space-y-3">
            <VarianceRow
              label="Staff on payroll"
              current={target.staffCount}
              prior={prior?.staffCount}
              formatter={(n) => `${n}`}
            />
            <VarianceRow
              label="Gross"
              current={num(target.totalGross)}
              prior={prior ? num(prior.totalGross) : null}
              formatter={ghsCompact}
            />
            <VarianceRow
              label="Net"
              current={num(target.totalNet)}
              prior={prior ? num(prior.totalNet) : null}
              formatter={ghsCompact}
            />
            <VarianceRow
              label="PAYE"
              current={num(target.totalPaye)}
              prior={prior ? num(prior.totalPaye) : null}
              formatter={ghsCompact}
            />
            <VarianceRow
              label="SSNIT"
              current={num(target.totalSsnit)}
              prior={prior ? num(prior.totalSsnit) : null}
              formatter={ghsCompact}
            />
            {!prior && (
              <p className="text-xs text-muted-foreground italic">
                No prior published run to compare against.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Publishing…
              </>
            ) : (
              <>
                <ShieldCheck className="mr-2 h-4 w-4" /> Confirm and publish
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Integer CENTS in, whole cedis out — display only, so the /100 is fine. */
function ghsCompact(cents: number): string {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function VarianceRow({
  label,
  current,
  prior,
  formatter,
}: {
  label: string
  current: number
  prior: number | null | undefined
  formatter: (n: number) => string
}) {
  let delta: number | null = null
  let pct: number | null = null
  if (prior !== null && prior !== undefined && prior !== 0) {
    delta = current - prior
    pct = (delta / prior) * 100
  }
  const isLarge = pct !== null && Math.abs(pct) >= 10

  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
      <div>
        <p className="font-medium">{label}</p>
        {prior !== null && prior !== undefined && prior !== 0 && (
          <p className="text-xs text-muted-foreground">Prior run: {formatter(prior)}</p>
        )}
      </div>
      <div className="text-right">
        <p className="font-semibold tabular-nums">{formatter(current)}</p>
        {delta !== null && pct !== null && (
          <p
            className={`flex items-center justify-end gap-1 text-xs tabular-nums ${
              isLarge ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
            }`}
          >
            {isLarge && <AlertTriangle className="h-3 w-3" />}
            {delta > 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : delta < 0 ? (
              <TrendingDown className="h-3 w-3" />
            ) : null}
            {delta > 0 ? '+' : ''}
            {formatter(delta)} ({pct > 0 ? '+' : ''}
            {Number(pct).toFixed(1)}%)
          </p>
        )}
      </div>
    </div>
  )
}
