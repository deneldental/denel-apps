import { CheckCircle2, Flag, Loader2, Paperclip, PiggyBank, Receipt } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  confirmPettyTransaction,
  flagPettyTransaction,
  getPettyBalance,
  getPettyTransactions,
  type PettyTransaction,
  recordPettyReplenishment,
} from '@/lib/actions/petty-cash'
import { uploadExpenseFile } from '@/lib/actions/upload'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import { cedisToCents, formatAmount } from '@/shared/utils/currency'

const ghs = (n: number) => `GHS ${formatAmount(Number(n))}`
const fmtDate = (s: string) => {
  try {
    return new Date(s).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    })
  } catch {
    return s
  }
}

const STATUS_BADGE: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  pending: { label: 'Pending', variant: 'secondary' },
  confirmed: { label: 'Confirmed', variant: 'default' },
  flagged: { label: 'Flagged', variant: 'destructive' },
}

export function PettyTransactionsTab() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('all')

  // Confirm / flag dialog
  const [action, setAction] = useState<{ txn: PettyTransaction; kind: 'confirm' | 'flag' } | null>(
    null
  )
  const [note, setNote] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  // No shared query-key group exists for petty-cash transactions — local
  // literal, module-scoped, keyed by the active filters.
  const {
    data,
    isLoading: loading,
    refetch: load,
  } = useApiQuery(['petty-cash', 'transactions', { from, to, status }] as const, () =>
    getPettyTransactions({
      from: from || undefined,
      to: to || undefined,
      status: status === 'all' ? undefined : status,
    })
  )
  const transactions = data?.transactions ?? []
  const totals = data?.totals ?? { count: 0, amount: 0, byStatus: {} }

  // Box balance under Settings → Finance → Petty Cash Policy (S5-B).
  const balanceQuery = useApiQuery(['petty-cash', 'balance'] as const, getPettyBalance)
  const balance = balanceQuery.data ?? null
  const [replenishOpen, setReplenishOpen] = useState(false)
  const [replenishAmount, setReplenishAmount] = useState('')
  const [replenishNote, setReplenishNote] = useState('')
  const replenish = useApiMutation(
    (vars: { amount: number; note?: string }) => recordPettyReplenishment(vars),
    { invalidates: [['petty-cash', 'balance'] as const] }
  )

  async function submitReplenishment() {
    const cedis = Number(replenishAmount)
    if (!Number.isFinite(cedis) || cedis <= 0) {
      toast.error('Enter the amount put into the box')
      return
    }
    try {
      await replenish.mutateAsync({
        amount: cedisToCents(cedis),
        note: replenishNote.trim() || undefined,
      })
      toast.success('Replenishment recorded')
      setReplenishOpen(false)
      setReplenishAmount('')
      setReplenishNote('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record the replenishment')
    }
  }

  function openAction(txn: PettyTransaction, kind: 'confirm' | 'flag') {
    setAction({ txn, kind })
    setNote('')
    setProof(null)
  }

  async function runAction() {
    if (!action) return
    setBusy(true)
    try {
      if (action.kind === 'confirm') {
        let proofUrl: string | undefined
        if (proof) {
          const up = await uploadExpenseFile({
            file: proof,
            category: 'petty-confirmation',
            paidTo: null,
            date: new Date(),
          })
          if (!up.success) {
            toast.error(up.error || 'Proof upload failed')
            setBusy(false)
            return
          }
          proofUrl = up.url || undefined
        }
        const res = await confirmPettyTransaction(action.txn.id, {
          note: note || undefined,
          proofUrl,
        })
        if (!res.success) {
          toast.error(res.error ?? 'Confirm failed')
          setBusy(false)
          return
        }
        toast.success('Confirmed')
      } else {
        if (!note.trim()) {
          toast.error('Add a reason for flagging')
          setBusy(false)
          return
        }
        const res = await flagPettyTransaction(action.txn.id, note.trim())
        if (!res.success) {
          toast.error(res.error ?? 'Flag failed')
          setBusy(false)
          return
        }
        toast.success('Flagged for follow-up')
      }
      setAction(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const pending = totals.byStatus.pending ?? 0

  return (
    <div className="p-6 space-y-4">
      {/* Box balance (Settings → Finance → Petty Cash Policy) */}
      {balance?.belowWarning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200">
          Box balance {ghs(balance.balance)} is below the replenishment alert of{' '}
          {ghs(balance.warningThreshold)}. Top up the box and record it below.
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <PiggyBank className={`h-4 w-4 ${balance?.belowWarning ? 'text-amber-600' : ''}`} />
            Box balance
          </div>
          <p
            className={`text-2xl font-bold tabular-nums ${balance?.belowWarning ? 'text-amber-600' : ''}`}
          >
            {balance ? ghs(balance.balance) : '—'}
          </p>
          {balance && (
            <p className="text-[11px] text-muted-foreground">
              {balance.source === 'replenishment'
                ? `Since the ${fmtDate(balance.since)} top-up of ${ghs(balance.floatAmount)}`
                : `Default float ${ghs(balance.floatAmount)}, spend since ${fmtDate(balance.since)}`}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-1 w-fit"
            onClick={() => setReplenishOpen(true)}
          >
            Record replenishment
          </Button>
        </div>
        <StatCard
          label="Transactions"
          value={loading ? '—' : String(totals.count)}
          icon={Receipt}
        />
        <StatCard label="Total spent" value={loading ? '—' : ghs(totals.amount)} icon={Receipt} />
        <StatCard
          label="Pending"
          value={loading ? '—' : String(pending)}
          icon={Flag}
          tone={pending > 0 ? 'text-amber-600' : undefined}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : transactions.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No petty cash transactions in this range.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Recipient</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">By</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const badge = STATUS_BADGE[t.confirmationStatus ?? 'pending']
                return (
                  <tr key={t.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-3 py-2">{fmtDate(t.date)}</td>
                    <td className="px-3 py-2">{t.categoryDisplay || t.category}</td>
                    <td className="px-3 py-2">
                      <div>{t.pettyRefName || t.paidTo || '—'}</div>
                      {t.pettyRefContact && (
                        <div className="text-xs text-muted-foreground">{t.pettyRefContact}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{ghs(t.amount)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {t.submittedBy || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={badge.variant} className="text-[10px]">
                        {badge.label}
                      </Badge>
                      {balance && t.amount > balance.approvalLimit && (
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          Over limit
                        </Badge>
                      )}
                      {t.confirmationStatus === 'flagged' && t.confirmationNote && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {t.confirmationNote}
                        </div>
                      )}
                      {t.confirmationProofUrl && (
                        <a
                          href={t.confirmationProofUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Paperclip className="h-3 w-3" /> proof
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {t.attachmentUrl && (
                          <a
                            href={t.attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                            aria-label="Receipt"
                          >
                            <Paperclip className="h-4 w-4" />
                          </a>
                        )}
                        {t.confirmationStatus !== 'confirmed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAction(t, 'confirm')}
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Confirm
                          </Button>
                        )}
                        {t.confirmationStatus !== 'flagged' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => openAction(t, 'flag')}
                          >
                            <Flag className="mr-1 h-3.5 w-3.5" /> Flag
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Record replenishment */}
      <Dialog open={replenishOpen} onOpenChange={setReplenishOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record replenishment</DialogTitle>
            <DialogDescription>
              Cash put into the petty-cash box. The balance restarts from this amount and counts
              petty disbursements from now on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="replenish-amount">Amount (GHS)</Label>
              <Input
                id="replenish-amount"
                type="number"
                min={0.01}
                step="0.01"
                value={replenishAmount}
                onChange={(e) => setReplenishAmount(e.target.value)}
                placeholder="e.g. 500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="replenish-note">Note (optional)</Label>
              <Textarea
                id="replenish-note"
                value={replenishNote}
                onChange={(e) => setReplenishNote(e.target.value)}
                rows={2}
                placeholder="e.g. withdrawn from the bank"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReplenishOpen(false)}
              disabled={replenish.isPending}
            >
              Cancel
            </Button>
            <Button onClick={submitReplenishment} disabled={replenish.isPending}>
              {replenish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm / flag dialog */}
      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action?.kind === 'confirm' ? 'Confirm transaction' : 'Flag transaction'}
            </DialogTitle>
            <DialogDescription>
              {action?.kind === 'confirm'
                ? 'Sign off after verifying (e.g. call the recipient). Note + proof are optional.'
                : 'Mark this as a suspected error / to follow up. A reason is required.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{action?.kind === 'confirm' ? 'Note (optional)' : 'Reason'}</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder={
                  action?.kind === 'confirm'
                    ? 'Verified with recipient…'
                    : 'e.g. amount looks wrong'
                }
              />
            </div>
            {action?.kind === 'confirm' && (
              <div className="space-y-1.5">
                <Label>Proof (optional)</Label>
                <Input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={runAction} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {action?.kind === 'confirm' ? 'Confirm' : 'Flag'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  icon: typeof Receipt
  tone?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-4 w-4 ${tone ?? ''}`} />
        {label}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${tone ?? ''}`}>{value}</p>
    </div>
  )
}
