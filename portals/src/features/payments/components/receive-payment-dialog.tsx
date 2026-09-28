import { cents } from '@denel/utils'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type InvoiceDraft,
  listPatientInvoices,
  listPlanInvoices,
  type PlanInvoiceSummary,
} from '@/lib/actions/invoices-v2'
import {
  type AllocationInput,
  createDraftPayment,
  type DraftPaymentInput,
  type PaymentMethod,
  postDraftPayment,
} from '@/lib/actions/payments-v2'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { localDateISO } from '@/shared/lib/dates'
import { formatCurrency, parseCurrency } from '@/shared/utils/currency'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName?: string
  onPosted?: () => void
  /** Scope to a plan's invoices when set. */
  planId?: string
  /** Scope to a single invoice when set. The user can still add other open
   *  invoices for the same patient via "+ Add another invoice". */
  invoiceId?: string
}

/** Minimal invoice shape the per-invoice rows render against. */
type OpenInvoice = {
  id: string
  invoiceNumber: string
  status: string
  balance: number
  dueDate: string | null
}

/** A single payment source — wallet, cash, momo, etc. The submit handler
 *  creates one draft payment per source (each posted individually), so the
 *  transactions list shows every movement with its own receipt. */
interface PaymentSource {
  key: string
  // Free-form so the configurable lookup's slug can be submitted verbatim; the
  // typed payment payload re-asserts `PaymentMethod` at the boundary below.
  method: string
  amount: string
  externalRef: string
}

function newSource(method = 'cash', amount = ''): PaymentSource {
  return {
    key: `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    method,
    amount,
    externalRef: '',
  }
}

export function ReceivePaymentDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  onPosted,
  planId,
  invoiceId,
}: Props) {
  const [paymentDate, setPaymentDate] = useState(localDateISO())

  /** Invoice IDs the user has selected for this payment. Order matters —
   *  auto-allocation distributes source money in this order (oldest first
   *  by default). */
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([])

  /** Sources funding this payment (split-payment support). */
  const [sources, setSources] = useState<PaymentSource[]>([newSource('cash', '')])

  const { isSubmitting: busy, submit } = useSubmitGuard()
  const queryClient = useQueryClient()

  // ── Fetch ───────────────────────────────────────────────────────────────
  // Scoped by patient/plan/invoice — a dedicated key, not shared with any
  // other screen (this combines two reads + a client-side filter/sort that
  // no other consumer needs).
  const dataQuery = useApiQuery<{ invoices: OpenInvoice[]; walletBalance: number }>(
    ['receive-payment', patientId, planId ?? null, invoiceId ?? null] as const,
    async () => {
      const invoicesFetcher = planId
        ? listPlanInvoices(planId).then((res) => ({
            success: res.success,
            error: res.error,
            rows: res.data.map(
              (inv: PlanInvoiceSummary): OpenInvoice => ({
                id: inv.id,
                invoiceNumber: inv.invoiceNumber,
                status: inv.status,
                balance: Number(inv.balance),
                dueDate: inv.dueDate,
              })
            ),
          }))
        : listPatientInvoices(patientId).then((res) => ({
            success: res.success,
            error: res.error,
            rows: res.data.map(
              (inv: InvoiceDraft): OpenInvoice => ({
                id: inv.id,
                invoiceNumber: inv.invoiceNumber,
                status: inv.status,
                balance: Number(inv.balance),
                dueDate: inv.dueDate,
              })
            ),
          }))

      const [invRes, wallet] = await Promise.all([
        invoicesFetcher,
        api
          .get<{ walletBalance: number }>(`/api/patients/${patientId}/ledger`)
          .then((r) => (r.success && r.data ? Number(r.data.walletBalance) : 0))
          .catch(() => 0),
      ])
      if (!invRes.success) {
        return { success: false, error: invRes.error ?? 'Failed to load invoices' }
      }
      // Keep only invoices that actually have an outstanding balance and are
      // in a payable state.
      const payable = invRes.rows.filter(
        (r) => r.balance > 0 && r.status !== 'void' && r.status !== 'written_off'
      )
      // Sort oldest-first by due date so auto-allocation walks them in
      // chronological order.
      const sorted = [...payable].sort((a, b) => {
        const ad = a.dueDate ?? ''
        const bd = b.dueDate ?? ''
        return ad.localeCompare(bd)
      })
      return { success: true, data: { invoices: sorted, walletBalance: wallet } }
    },
    { enabled: open }
  )
  const allOpenInvoices = dataQuery.data?.invoices ?? []
  const walletBalance = dataQuery.data?.walletBalance ?? 0
  const loading = dataQuery.isLoading

  useEffect(() => {
    if (dataQuery.isError) toast.error(dataQuery.error.message || 'Failed to load invoices')
  }, [dataQuery.isError, dataQuery.error])

  // Reset the per-open form fields whenever the dialog (re)opens.
  useEffect(() => {
    if (!open) return
    setSources([newSource('cash', '')])
    setPaymentDate(localDateISO())
  }, [open])

  // Seed the initial invoice selection once the invoice list loads (or
  // changes) while open. Structural sharing keeps `dataQuery.data` the same
  // reference across a no-op background refetch, so this doesn't clobber a
  // selection the user is still editing.
  useEffect(() => {
    if (!open || !dataQuery.data) return
    const sorted = dataQuery.data.invoices
    // Initial selection: respect the caller's scope.
    if (invoiceId) {
      const match = sorted.find((r) => r.id === invoiceId)
      setSelectedInvoiceIds(match ? [match.id] : [])
    } else if (planId) {
      // Plan scope: pre-select all of the plan's payable invoices.
      setSelectedInvoiceIds(sorted.map((r) => r.id))
    } else {
      // Patient scope: pre-select the oldest one so the receptionist gets a
      // sensible starting point.
      setSelectedInvoiceIds(sorted.length > 0 ? [sorted[0].id] : [])
    }
  }, [open, dataQuery.data, invoiceId, planId])

  // ── Derived sets ────────────────────────────────────────────────────────
  const selectedInvoices = useMemo(
    () =>
      selectedInvoiceIds
        .map((id) => allOpenInvoices.find((i) => i.id === id))
        .filter((i): i is OpenInvoice => !!i),
    [selectedInvoiceIds, allOpenInvoices]
  )
  const addableInvoices = useMemo(
    () => allOpenInvoices.filter((i) => !selectedInvoiceIds.includes(i.id)),
    [allOpenInvoices, selectedInvoiceIds]
  )

  // Source inputs hold cedis TEXT; `parseCurrency` returns integer CENTS —
  // the unit `inv.balance`, `walletBalance` and the API all use, so every
  // comparison and allocation below stays in one unit.
  const sourceTotal = useMemo(
    () => sources.reduce((s, src) => s + parseCurrency(src.amount), 0),
    [sources]
  )
  const walletUsed = useMemo(
    () =>
      sources
        .filter((s) => s.method === 'wallet')
        .reduce((sum, s) => sum + parseCurrency(s.amount), 0),
    [sources]
  )
  const invoicesOutstandingTotal = useMemo(
    () => selectedInvoices.reduce((s, inv) => s + inv.balance, 0),
    [selectedInvoices]
  )

  // Auto-allocation: distribute sourceTotal across selectedInvoices in the
  // order they appear. Capped at each invoice's outstanding balance. This
  // is recomputed deterministically every render — the receptionist doesn't
  // edit per-invoice amounts (kept simple; if they want a custom split they
  // can drop invoices from the list).
  const allocations = useMemo(() => {
    const map = new Map<string, number>()
    let remaining = sourceTotal
    for (const inv of selectedInvoices) {
      // Cents are integers — nothing to round.
      const take = Math.min(inv.balance, remaining)
      map.set(inv.id, take)
      remaining = Math.max(0, remaining - take)
      if (remaining <= 0) break
    }
    return map
  }, [selectedInvoices, sourceTotal])

  const allocatedTotal = useMemo(
    () => Array.from(allocations.values()).reduce((s, v) => s + v, 0),
    [allocations]
  )
  /** Source-side money that has nowhere to go because every selected invoice
   *  is fully covered. We BLOCK submit in this state — the user must either
   *  add more invoices or reduce the source amount. No silent top-ups to
   *  the wallet from this dialog. */
  const overspill = Math.max(0, sourceTotal - allocatedTotal)
  const overspillSignificant = overspill > 0

  const walletOverdrawn = walletUsed > walletBalance
  const sourcesUnderfunded = sourceTotal <= 0

  // ── Dirty guard ─────────────────────────────────────────────────────────
  /** Form is considered dirty once any source has an amount or reference. */
  const isDirty = useMemo(
    () => sources.some((s) => s.amount !== '' || s.externalRef !== ''),
    [sources]
  )

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  // ── Source helpers ──────────────────────────────────────────────────────
  function addSource() {
    setSources((prev) => [...prev, newSource('cash', '')])
  }
  function removeSource(key: string) {
    if (sources.length <= 1) return
    setSources((prev) => prev.filter((s) => s.key !== key))
  }
  function updateSource(key: string, patch: Partial<PaymentSource>) {
    setSources((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  // ── Invoice helpers ─────────────────────────────────────────────────────
  function addInvoice(id: string) {
    if (selectedInvoiceIds.includes(id)) return
    setSelectedInvoiceIds((prev) => [...prev, id])
  }
  function removeInvoice(id: string) {
    setSelectedInvoiceIds((prev) => prev.filter((i) => i !== id))
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  const submitOnSubmit = useCallback(() => {
    submit(async () => {
      if (!paymentDate) {
        toast.error('Payment date is required')
        return
      }
      if (sourcesUnderfunded) {
        toast.error('Enter at least one payment source amount')
        return
      }
      for (const src of sources) {
        const n = parseCurrency(src.amount)
        if (n < 0) {
          toast.error('Source amounts cannot be negative')
          return
        }
        if (n <= 0) {
          toast.error('Every source needs an amount greater than 0')
          return
        }
      }
      if (selectedInvoices.length === 0) {
        toast.error('Pick at least one invoice to pay against')
        return
      }
      if (overspillSignificant) {
        toast.error(
          `Sources exceed the invoice balance by ${formatCurrency(overspill)} — reduce the source amount or add another invoice. Wallet top-ups happen in the Wallet card, not here.`
        )
        return
      }
      if (walletOverdrawn) {
        toast.error(
          `Wallet credit available is ${formatCurrency(walletBalance)} — you've tried to use ${formatCurrency(walletUsed)}.`
        )
        return
      }

      // Distribute source money to invoices in the selected order. This mirrors
      // the auto-allocation `allocations` map above, but split across sources:
      //   sources = [wallet 700, cash 300] + invoices = [A 1000, B 200]
      //     → wallet pays 700 of A
      //     → cash pays 300 of A
      //   sources = [wallet 800] + invoices = [A 500, B 300]
      //     → wallet pays 500 of A, then 300 of B
      const allocList = selectedInvoices
        .map((inv) => ({ invoiceId: inv.id, amount: allocations.get(inv.id) ?? 0 }))
        .filter((a) => a.amount > 0)

      // Use a stable group id for split payments so the receipt endpoint can
      // link sibling transactions. crypto.randomUUID() is always available in
      // a Vite SPA served over HTTPS/localhost.
      const paymentGroupId = sources.length > 1 ? crypto.randomUUID() : null

      let allocCursor = 0
      let allocRemaining = allocList[0]?.amount ?? 0

      // Track successfully posted draft ids so partial-failure can be surfaced
      // without silently hiding work that did complete.
      const postedSourceIndices: number[] = []

      try {
        for (let srcIdx = 0; srcIdx < sources.length; srcIdx++) {
          const src = sources[srcIdx]!
          // Plain `number` for the running split: subtracting from a `Cents`
          // value yields a number, and re-tagging on every decrement would be
          // noise. The unit is re-asserted once, where a value enters the typed
          // payload — `cents()` throws on a fractional pesewa.
          let srcRemaining: number = parseCurrency(src.amount)
          const sourceAllocs: AllocationInput[] = []
          while (srcRemaining > 0 && allocCursor < allocList.length) {
            const take = Math.min(srcRemaining, allocRemaining)
            if (take > 0) {
              sourceAllocs.push({
                targetType: 'invoice',
                targetId: allocList[allocCursor].invoiceId,
                amount: cents(take),
              })
              srcRemaining -= take
              allocRemaining -= take
            }
            if (allocRemaining <= 0) {
              allocCursor++
              allocRemaining = allocList[allocCursor]?.amount ?? 0
            }
          }

          const draft: DraftPaymentInput = {
            patientId,
            amount: parseCurrency(src.amount),
            // Lookup slug submitted verbatim — the backend accepts any non-empty
            // string for `method` (no enum). Cast to satisfy the payload type.
            method: src.method as PaymentMethod,
            paymentDate,
            externalReference: src.externalRef.trim() || null,
            allocations: sourceAllocs,
            paymentPlanId: planId ?? null,
            paymentGroupId,
          }
          const draftRes = await createDraftPayment(draft)
          if (!draftRes.success || !draftRes.data) {
            throw new Error(draftRes.error ?? 'Failed to create draft payment')
          }
          const postRes = await postDraftPayment(draftRes.data.id)
          if (!postRes.success) {
            throw new Error(postRes.error ?? 'Failed to post payment')
          }
          postedSourceIndices.push(srcIdx)
        }

        toast.success(
          `Posted ${sources.length} payment${sources.length > 1 ? 's' : ''} — total ${formatCurrency(sourceTotal)}`
        )
        queryClient.invalidateQueries({ queryKey: queryKeys.patients.balance(patientId) })
        onOpenChange(false)
        onPosted?.()
      } catch (err) {
        const postedCount = postedSourceIndices.length
        if (postedCount > 0) {
          // Partial success — close the dialog and refresh so posted payments
          // are visible and the user is not at risk of double-posting.
          toast.error(
            `${postedCount} of ${sources.length} payment${sources.length > 1 ? 's' : ''} posted — one failed: ${err instanceof Error ? err.message : 'Unknown error'}. Check the transactions list.`
          )
          queryClient.invalidateQueries({ queryKey: queryKeys.patients.balance(patientId) })
          onOpenChange(false)
          onPosted?.()
        } else {
          toast.error(err instanceof Error ? err.message : 'Failed to post payment')
        }
      }
    })
  }, [
    submit,
    sources,
    sourcesUnderfunded,
    selectedInvoices,
    overspill,
    overspillSignificant,
    walletOverdrawn,
    walletBalance,
    walletUsed,
    allocations,
    paymentDate,
    patientId,
    planId,
    sourceTotal,
    onOpenChange,
    onPosted,
    queryClient,
  ])

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (busy ? null : guardedOnOpenChange(o))}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Receive payment{patientName ? ` — ${patientName}` : ''}
              {invoiceId && !planId ? ' (invoice)' : planId ? ' (plan)' : ''}
            </DialogTitle>
            <DialogDescription>
              Receive a payment against one or more open invoices. The source amount is
              auto-allocated to the invoices in order; reduce the source or add another invoice if
              there's a leftover. Wallet top-ups are handled separately from the Wallet card.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* ── Payment sources ───────────────────────────────────────── */}
            <div className="rounded-md border">
              <div className="flex items-center justify-between p-3 border-b">
                <div>
                  <div className="text-sm font-medium">Payment sources</div>
                  <p className="text-[11px] text-muted-foreground">
                    Each source becomes its own transaction line with a receipt.
                    {walletBalance > 0 && (
                      <>
                        {' '}
                        Wallet credit available:{' '}
                        <strong className="text-emerald-700">
                          {formatCurrency(walletBalance)}
                        </strong>
                        .
                      </>
                    )}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={addSource}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add source
                </Button>
              </div>
              <div className="divide-y">
                {sources.map((src) => {
                  const overdraft =
                    src.method === 'wallet' &&
                    Number(src.amount) > 0 &&
                    walletUsed > walletBalance + 0.005
                  return (
                    <div
                      key={src.key}
                      className="grid grid-cols-[180px_140px_1fr_auto] gap-2 items-center p-3"
                    >
                      <PaymentMethodSelect
                        value={src.method}
                        onValueChange={(v) => updateSource(src.key, { method: v })}
                        className="h-9"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={src.amount}
                        onChange={(e) => updateSource(src.key, { amount: e.target.value })}
                        className={`h-9 text-right ${overdraft ? 'border-red-400' : ''}`}
                      />
                      {src.method === 'wallet' ? (
                        <div
                          className={`h-9 flex items-center justify-between rounded-md border px-3 text-xs ${
                            overdraft
                              ? 'border-red-400 text-red-600'
                              : 'border-input text-muted-foreground'
                          }`}
                        >
                          <span>Wallet credit remaining</span>
                          <span className="font-mono font-semibold">
                            {formatCurrency(Math.max(0, walletBalance - walletUsed))}
                          </span>
                        </div>
                      ) : (
                        <Input
                          type="text"
                          placeholder="Reference (MoMo txn, bank ref, cheque #…)"
                          value={src.externalRef}
                          onChange={(e) => updateSource(src.key, { externalRef: e.target.value })}
                          disabled={src.method === 'cash'}
                          className="h-9"
                        />
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeSource(src.key)}
                        disabled={sources.length <= 1}
                        aria-label="Remove source"
                        className="h-9 w-9"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── Payment date ──────────────────────────────────────────── */}
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-3">
                <Label htmlFor="rp-date">Payment date</Label>
                <Input
                  id="rp-date"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
            </div>

            {/* ── Invoices being paid ───────────────────────────────────── */}
            <div className="border rounded">
              <div className="flex items-center justify-between p-3 border-b">
                <div>
                  <div className="text-sm font-medium">Invoices being paid</div>
                  <p className="text-[11px] text-muted-foreground">
                    Source money is auto-allocated to these invoices in order (oldest first).
                  </p>
                </div>
                {addableInvoices.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="sm" variant="outline">
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Add invoice
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                      {addableInvoices.map((inv) => (
                        <DropdownMenuItem
                          key={inv.id}
                          onSelect={() => addInvoice(inv.id)}
                          className="flex items-center justify-between gap-3"
                        >
                          <div className="flex flex-col">
                            <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {inv.dueDate ? `Due ${inv.dueDate}` : 'No due date'}
                            </span>
                          </div>
                          <span className="font-mono text-xs text-red-600">
                            {formatCurrency(inv.balance)}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {loading ? (
                <Skeleton className="h-32 m-3" />
              ) : selectedInvoices.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">
                  {addableInvoices.length > 0
                    ? 'Click "Add invoice" to pick one or more invoices.'
                    : 'No open invoices for this patient.'}
                </p>
              ) : (
                <div className="divide-y">
                  {selectedInvoices.map((inv) => {
                    const allocated = allocations.get(inv.id) ?? 0
                    const newBalance = Math.max(0, inv.balance - allocated)
                    const fullyPaid = newBalance < 0.005 && allocated > 0
                    return (
                      <div
                        key={inv.id}
                        className="p-3 grid grid-cols-[1fr_auto_auto] gap-3 items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold">
                              {inv.invoiceNumber}
                            </span>
                            {fullyPaid && (
                              <Badge className="bg-emerald-600 hover:bg-emerald-700 text-[9px] h-4 px-1.5">
                                Will be paid
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Current balance:{' '}
                            <span className="font-mono">{formatCurrency(inv.balance)}</span>
                            {' · '}
                            After this payment:{' '}
                            <span
                              className={`font-mono ${
                                fullyPaid ? 'text-emerald-700' : 'text-foreground'
                              }`}
                            >
                              {formatCurrency(newBalance)}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Applied
                          </div>
                          <div className="font-mono text-sm font-semibold">
                            {formatCurrency(allocated)}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => removeInvoice(inv.id)}
                          disabled={selectedInvoices.length === 1 && (!!invoiceId || !!planId)}
                          aria-label="Remove invoice"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Running totals (no unallocated section) ──────────────── */}
            <div className="rounded-md border bg-muted/20 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Total payment</span>
                <span className="font-mono font-semibold">{formatCurrency(sourceTotal)}</span>
              </div>
              {walletUsed > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>From wallet credit</span>
                  <span className="font-mono">{formatCurrency(walletUsed)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Selected invoices ({selectedInvoices.length}) outstanding</span>
                <span className="font-mono">{formatCurrency(invoicesOutstandingTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Outstanding after this payment</span>
                <span className="font-mono">
                  {formatCurrency(Math.max(0, invoicesOutstandingTotal - allocatedTotal))}
                </span>
              </div>

              {/* Errors */}
              {overspillSignificant && (
                <div className="mt-2">
                  <Badge variant="destructive">
                    Sources exceed invoice balance by {formatCurrency(overspill)} — reduce source or
                    add another invoice
                  </Badge>
                </div>
              )}
              {walletOverdrawn && (
                <div className="mt-2">
                  <Badge variant="destructive">Wallet credit insufficient</Badge>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => guardedOnOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitOnSubmit}
              disabled={
                busy ||
                loading ||
                sourcesUnderfunded ||
                selectedInvoices.length === 0 ||
                overspillSignificant ||
                walletOverdrawn
              }
            >
              {busy
                ? 'Posting…'
                : sources.length > 1
                  ? `Post ${sources.length} payments`
                  : 'Post payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
