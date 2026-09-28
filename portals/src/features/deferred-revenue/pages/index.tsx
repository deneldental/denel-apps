import { cedisToCents } from '@denel/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type DeferredRevenueEvent,
  type DeferredRevenueLine,
  listDeferredLines,
  listLineEvents,
  recognizeRevenue,
} from '@/lib/actions/deferred-revenue'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card'
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
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { Textarea } from '@/shared/components/ui/textarea'
import { formatCurrency } from '@/shared/utils/currency'

type Mode = 'outstanding' | 'all'

export default function DeferredRevenuePage() {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('outstanding')

  const [target, setTarget] = useState<DeferredRevenueLine | null>(null)
  const [amount, setAmount] = useState('')
  const [trigger, setTrigger] = useState<'manual' | 'milestone' | 'period_close'>('manual')
  const [milestoneRef, setMilestoneRef] = useState('')
  const [notes, setNotes] = useState('')

  const {
    data: rows = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.deferredRevenue.lines(mode === 'outstanding'),
    queryFn: async () => {
      const res = await listDeferredLines({ outstandingOnly: mode === 'outstanding' })
      if (!res.success) throw new Error(res.error ?? 'Failed to load')
      return res.data
    },
  })

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: queryKeys.deferredRevenue.events(target?.invoiceLineId ?? ''),
    queryFn: async () => {
      const res = await listLineEvents(target?.invoiceLineId ?? '')
      return res.success ? res.data : []
    },
    enabled: target !== null,
  })

  const recognizeMutation = useMutation({
    mutationFn: ({
      invoiceLineId,
      payload,
    }: {
      invoiceLineId: string
      payload: {
        amount: number
        trigger: 'manual' | 'milestone' | 'period_close'
        milestoneRef: string | null
        notes: string | null
      }
    }) => recognizeRevenue(invoiceLineId, payload),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.error ?? 'Failed to recognize')
        return
      }
      toast.success(
        `Recognised ${formatCurrency(Number(amount))} — JE ${res.data?.journalEntry.entryNumber ?? ''}`
      )
      setTarget(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.deferredRevenue.all })
    },
    onError: () => toast.error('Failed to recognize revenue'),
  })

  function openLine(line: DeferredRevenueLine) {
    setTarget(line)
    // CEDIS in the field, cents on the wire — `remainingDeferred` is cents, so
    // seeding it raw showed GH₵500.00 of deferred revenue as "50000.00".
    setAmount((Number(line.remainingDeferred) / 100).toFixed(2))
    setTrigger('manual')
    setMilestoneRef('')
    setNotes('')
  }

  function onRecognize() {
    if (!target) return
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error('Enter a positive amount')
    const amtCents = cedisToCents(amt)
    if (amtCents > target.remainingDeferred) return toast.error('Exceeds remaining deferred')

    recognizeMutation.mutate({
      invoiceLineId: target.invoiceLineId,
      payload: {
        amount: amtCents,
        trigger,
        milestoneRef: milestoneRef.trim() || null,
        notes: notes.trim() || null,
      },
    })
  }

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        total: acc.total + r.lineAfterDiscount,
        recognised: acc.recognised + r.recognizedAmount,
        remaining: acc.remaining + r.remainingDeferred,
      }),
      { total: 0, recognised: 0, remaining: 0 }
    )
  }, [rows])

  const busy = recognizeMutation.isPending

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Deferred revenue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Invoice lines that posted to 2400 Deferred Revenue at issue. Recognise revenue as
          treatment milestones are delivered (spec §6.5 alt policy). Each recognition writes DR
          Deferred Revenue / CR the line's revenue account.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total invoiced (deferred lines)</CardDescription>
            <CardTitle className="text-2xl font-mono">{formatCurrency(summary.total)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Recognised to date</CardDescription>
            <CardTitle className="text-2xl font-mono text-emerald-600">
              {formatCurrency(summary.recognised)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Still deferred (= 2400 balance)</CardDescription>
            <CardTitle className="text-2xl font-mono">
              {formatCurrency(summary.remaining)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="outstanding">Outstanding</TabsTrigger>
          <TabsTrigger value="all">All deferred lines</TabsTrigger>
        </TabsList>
      </Tabs>

      {isError && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>Failed to load deferred lines.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: queryKeys.deferredRevenue.all })
            }
          >
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deferred lines.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Revenue account</TableHead>
              <TableHead className="text-right">Line total</TableHead>
              <TableHead className="text-right">Recognised</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.invoiceLineId}>
                <TableCell className="font-mono text-sm">{r.invoiceNumber}</TableCell>
                <TableCell className="text-sm">{r.description}</TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">
                  {r.revenueAccountCode} — {r.revenueAccountName}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(r.lineAfterDiscount)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(r.recognizedAmount)}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={r.remainingDeferred > 0 ? 'secondary' : 'outline'}>
                    {formatCurrency(r.remainingDeferred)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openLine(r)}
                    disabled={r.remainingDeferred <= 0}
                  >
                    Recognise
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Recognise deferred revenue — {target?.invoiceNumber}</DialogTitle>
            <DialogDescription>
              Posts DR 2400 Deferred Revenue / CR {target?.revenueAccountCode}{' '}
              {target?.revenueAccountName}. Remaining deferred:{' '}
              {target ? formatCurrency(target.remainingDeferred) : '—'}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Trigger</Label>
                <Select
                  value={trigger}
                  onValueChange={(v) => setTrigger(v as 'manual' | 'milestone' | 'period_close')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="milestone">Milestone</SelectItem>
                    <SelectItem value="period_close">Period close</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Milestone ref</Label>
                <Input
                  value={milestoneRef}
                  onChange={(e) => setMilestoneRef(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Prior recognition events</p>
              {eventsLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No prior events.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Milestone</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(events as DeferredRevenueEvent[]).map((e) => (
                      <TableRow key={e.id} className={e.reversed ? 'opacity-50 line-through' : ''}>
                        <TableCell className="text-sm">
                          {new Date(e.recognizedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-sm">{e.trigger}</TableCell>
                        <TableCell className="text-sm">{e.milestoneRef ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(e.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={onRecognize} disabled={busy}>
              {busy ? 'Posting…' : 'Recognise'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
