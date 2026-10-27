import { cents } from '@denel/utils'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type ReceiptDataShape,
  ReceiptViewDialog,
} from '@/features/payments/components/receipt-view-dialog'
import {
  type InvoiceDraft,
  type InvoiceLine,
  type LegacyTreatment,
  listInvoiceLines,
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
import { Checkbox } from '@/shared/components/ui/checkbox'
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
import { openReceiptWindow, printOutstandingBalanceSlip } from '@/shared/utils/receipt'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName?: string
  onPosted?: () => void
  /** The visit this payment is for (at check-in); every payment posted names it. */
  appointmentId?: string
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
  /** An archived invoice is put away: it is not offered for payment (the ledger's outstanding
   *  total leaves it out too). */
  archived: boolean
  /** Only for invoices raised by the old plan path, which have no invoice lines (see
   *  `deriveInvoiceDisplayItems`). */
  treatments?: LegacyTreatment[] | null
}

export type InvoiceDisplayItem = { name: string; cost: number }

/**
 * What an invoice being paid is for, as a list of services with their amounts.
 *
 * It prefers the invoice's real lines. Invoices raised by the old payment-plan path never got
 * lines: the services they were raised for live only in the invoice's `treatments` column, so
 * that is used when there are no lines.
 */
export function deriveInvoiceDisplayItems(
  lines: Pick<InvoiceLine, 'description' | 'lineTotal'>[] | undefined,
  treatments: LegacyTreatment[] | null | undefined
): InvoiceDisplayItem[] {
  const fromLines = (lines ?? [])
    .map((l) => ({ name: (l.description ?? '').trim(), cost: Number(l.lineTotal) }))
    .filter((item) => item.name.length > 0)
  if (fromLines.length > 0) return fromLines

  return (treatments ?? [])
    .map((t) => ({ name: (t.name ?? '').trim(), cost: Number(t.amount) }))
    .filter((item) => item.name.length > 0 && Number.isFinite(item.cost))
}

/** One invoice's services, or the fact that they could not be loaded. */
type InvoiceLines = { ok: true; lines: InvoiceLine[] } | { ok: false }

/**
 * What the patient's ledger (`GET /api/patients/:id/ledger`) says about money, as the SERVER works
 * it out. Each part is null when it could not be read: a failed read is "unknown" and is shown as
 * unknown, never as zero.
 */
type LedgerReadout = {
  walletBalance: number | null
  outstanding: {
    total: number
    invoices: Array<{ id: string; invoiceNumber: string; balance: number; dueDate: string | null }>
  } | null
}

/** The part of the ledger that says what the patient owes, once it is known to have been read. */
type KnownOutstanding = NonNullable<LedgerReadout['outstanding']>

const UNKNOWN_LEDGER: LedgerReadout = { walletBalance: null, outstanding: null }

const finiteOrNull = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function readLedger(res: { success: boolean; data?: unknown }): LedgerReadout {
  if (!res.success || !res.data || typeof res.data !== 'object') return UNKNOWN_LEDGER
  const d = res.data as Record<string, unknown>
  const total = finiteOrNull(d.outstandingBalance)
  const list = d.outstandingInvoices
  return {
    walletBalance: finiteOrNull(d.walletBalance),
    outstanding:
      total !== null && Array.isArray(list)
        ? {
            total,
            invoices: list.map((i: Record<string, unknown>) => ({
              id: String(i.id),
              invoiceNumber: String(i.invoiceNumber),
              balance: Number(i.balance),
              dueDate: i.dueDate ? String(i.dueDate) : null,
            })),
          }
        : null,
  }
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
  appointmentId,
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

  /** Print a "total outstanding balance" slip after the payment posts. Separate from the
   *  per-payment receipt, which is unaffected. */
  const [printOutstanding, setPrintOutstanding] = useState(false)

  /** Text the patient a payment confirmation (G08). The server names what was posted and texts an
   *  event once; the dialog asks with the last payment it posts, so a split is texted for its total. */
  const [sendSms, setSendSms] = useState(true)

  const { isSubmitting: busy, submit } = useSubmitGuard()
  const queryClient = useQueryClient()

  // ── Receipt (shown by itself after a successful post) ─────────────────────
  const [showReceiptDialog, setShowReceiptDialog] = useState(false)
  const [receiptData, setReceiptData] = useState<ReceiptDataShape | null>(null)
  /** Closing the dialog and firing `onPosted` unmounts this component at several call sites (they
   *  gate rendering on what `onPosted` clears), so both wait until the receipt is dismissed:
   *  otherwise the receipt would never get the chance to render. */
  const finalizeRef = useRef<(() => void) | null>(null)

  // ── Fetch ───────────────────────────────────────────────────────────────
  // Scoped by patient/plan/invoice — a dedicated key, not shared with any
  // other screen (this combines two reads + a client-side filter/sort that
  // no other consumer needs).
  const dataQuery = useApiQuery<{ invoices: OpenInvoice[]; ledger: LedgerReadout }>(
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
                // The plan's own list already leaves archived invoices out.
                archived: false,
                treatments: inv.treatments ?? null,
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
                archived: inv.archived === true,
                treatments: inv.treatments ?? null,
              })
            ),
          }))

      // The ledger is the server's own account of the patient's money: the wallet credit, and the
      // total outstanding across EVERY open invoice (which the invoices listed here may be only a
      // part of). A read that fails is unknown, not zero.
      const [invRes, ledger] = await Promise.all([
        invoicesFetcher,
        api
          .get<unknown>(`/api/patients/${patientId}/ledger`)
          .then(readLedger)
          .catch(() => UNKNOWN_LEDGER),
      ])
      if (!invRes.success) {
        return { success: false, error: invRes.error ?? 'Failed to load invoices' }
      }
      // Keep only invoices that actually have an outstanding balance and are
      // in a payable state.
      const payable = invRes.rows.filter(
        (r) => r.balance > 0 && !r.archived && r.status !== 'void' && r.status !== 'written_off'
      )
      // Sort oldest-first by due date so auto-allocation walks them in
      // chronological order.
      const sorted = [...payable].sort((a, b) => {
        const ad = a.dueDate ?? ''
        const bd = b.dueDate ?? ''
        return ad.localeCompare(bd)
      })
      return { success: true, data: { invoices: sorted, ledger } }
    },
    { enabled: open }
  )
  const allOpenInvoices = dataQuery.data?.invoices ?? []
  const ledger = dataQuery.data?.ledger ?? UNKNOWN_LEDGER
  // null = not known (still loading, or the ledger could not be read): never treated as zero.
  const walletBalance = ledger.walletBalance
  const outstanding = ledger.outstanding
  const loading = dataQuery.isLoading
  const loadFailed = dataQuery.isError

  useEffect(() => {
    if (dataQuery.isError) toast.error(dataQuery.error.message || 'Failed to load invoices')
  }, [dataQuery.isError, dataQuery.error])

  // Reset the per-open form fields whenever the dialog (re)opens.
  useEffect(() => {
    if (!open) return
    setSources([newSource('cash', '')])
    setPaymentDate(localDateISO())
    setPrintOutstanding(false)
    setSendSms(true)
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

  // What each selected invoice is for. One read per invoice, each recording on its own whether it
  // worked, so a failure on one is shown on that invoice and does not blank the others.
  const lineItemsKey = useMemo(() => [...selectedInvoiceIds].sort().join(','), [selectedInvoiceIds])
  const lineItemsQuery = useApiQuery<Record<string, InvoiceLines>>(
    ['receive-payment-lines', lineItemsKey] as const,
    async () => {
      const ids = lineItemsKey ? lineItemsKey.split(',') : []
      const results = await Promise.all(ids.map((id) => listInvoiceLines(id)))
      const byInvoiceId: Record<string, InvoiceLines> = {}
      results.forEach((res, idx) => {
        byInvoiceId[ids[idx]] = res.success ? { ok: true, lines: res.data } : { ok: false }
      })
      return { success: true, data: byInvoiceId }
    },
    { enabled: open && lineItemsKey.length > 0 }
  )
  const linesByInvoiceId = lineItemsQuery.data ?? {}

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

  // Paying from the wallet needs the wallet credit to be KNOWN and to cover it: credit that could
  // not be read is not credit of zero to be silently worked around, it is a reason to say so.
  const walletUnknown = walletUsed > 0 && walletBalance === null
  const walletOverdrawn = walletUsed > 0 && walletBalance !== null && walletUsed > walletBalance
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

  // ── Receipt ─────────────────────────────────────────────────────────────
  /** Runs after a (fully or partly) successful post. Shows the receipt for `paymentId` and defers
   *  closing the dialog and `onPosted` until it is dismissed. Not at a visit: a check-in follows
   *  the payment as a request of its own and must not wait for a receipt to be closed. Finishes
   *  at once when there is no receipt to show or it cannot be loaded. */
  const showReceiptThenFinish = useCallback(
    async (paymentId: string | null) => {
      const finalize = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.patients.balance(patientId) })
        onOpenChange(false)
        onPosted?.()
      }
      if (!paymentId || appointmentId) {
        finalize()
        return
      }
      try {
        const res = await api.get<ReceiptDataShape>(`/api/payments/${paymentId}/receipt`)
        if (res.success && res.data) {
          finalizeRef.current = finalize
          setReceiptData(res.data)
          setShowReceiptDialog(true)
          return
        }
      } catch {
        // Fall through: the payment posted fine, only its receipt could not be loaded.
      }
      toast.error('Payment posted, but the receipt could not be loaded for printing.')
      finalize()
    },
    [queryClient, patientId, appointmentId, onOpenChange, onPosted]
  )

  // ── Outstanding-balance slip ────────────────────────────────────────────
  /** Print the patient's outstanding-balance slip into `win`. `before` is what the ledger said was
   *  outstanding when the form loaded (the state before the payment): the slip is never made
   *  without it, since a slip of zeros would be worse than none. The balances printed are the
   *  SERVER's, read again after the posting: an invoice's balance before the payment is what the
   *  server now says plus what this payment applied to it. If they cannot be read again, `before`
   *  is used as it is. Never throws: the payment is posted whatever happens here. */
  const printSlip = useCallback(
    async (win: Window, before: KnownOutstanding) => {
      try {
        let invoices = before.invoices.map((i) => ({
          invoiceNumber: i.invoiceNumber,
          dueDate: i.dueDate,
          balanceBefore: i.balance,
        }))
        let balanceDue = Math.max(0, before.total - allocatedTotal)
        try {
          const fresh = readLedger(
            await api.get<unknown>(`/api/patients/${patientId}/ledger`)
          ).outstanding
          if (fresh) {
            const listed = new Set(fresh.invoices.map((i) => i.id))
            invoices = fresh.invoices.map((i) => ({
              invoiceNumber: i.invoiceNumber,
              dueDate: i.dueDate,
              balanceBefore: i.balance + (allocations.get(i.id) ?? 0),
            }))
            // An invoice this payment settled is no longer outstanding on the server, but it was.
            for (const inv of selectedInvoices) {
              const applied = allocations.get(inv.id) ?? 0
              if (!listed.has(inv.id) && applied > 0) {
                invoices.push({
                  invoiceNumber: inv.invoiceNumber,
                  dueDate: inv.dueDate,
                  balanceBefore: applied,
                })
              }
            }
            balanceDue = fresh.total
          }
        } catch {
          // Keep the balances loaded with the form.
        }
        // Most call sites don't pass a name — look it up rather than print a placeholder.
        let name = patientName
        if (!name) {
          try {
            const res = await api.get<{ name: string }>(`/api/patients/${patientId}`)
            name = res.data?.name
          } catch {
            // fall through to the placeholder
          }
        }
        await printOutstandingBalanceSlip({
          patientName: name ?? 'Patient',
          invoices: [...invoices].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
          paidNow: allocatedTotal,
          balanceDue,
          existingWindow: win,
        })
      } catch {
        win.close()
        toast.error(
          'The payment was posted, but the outstanding-balance slip could not be printed.'
        )
      }
    },
    [patientId, patientName, selectedInvoices, allocations, allocatedTotal]
  )

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
      if (walletUnknown) {
        toast.error(
          'Wallet credit could not be loaded, so a wallet payment cannot be taken right now. Try again, or pay by another method.'
        )
        return
      }
      if (walletOverdrawn) {
        toast.error(
          `Wallet credit available is ${formatCurrency(walletBalance ?? 0)} — you've tried to use ${formatCurrency(walletUsed)}.`
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
      // without silently hiding work that did complete, and so the receipt can be loaded for
      // the payment(s) that actually posted.
      const postedSourceIndices: number[] = []
      const postedPaymentIds: string[] = []
      /** Why the payment-confirmation text failed, when it did (the payment stands either way). */
      let smsError: string | undefined

      // Opened here, synchronously and still inside the click: a popup opened after the postings
      // below would be blocked by the browser. Only when the slip can be made from known balances.
      const slipBasis = printOutstanding ? outstanding : null
      const slipWindow = slipBasis ? openReceiptWindow('balance slip') : null
      let slipHandedOver = false

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
            appointmentId: appointmentId ?? null,
            paymentPlanId: planId ?? null,
            paymentGroupId,
          }
          const draftRes = await createDraftPayment(draft)
          if (!draftRes.success || !draftRes.data) {
            throw new Error(draftRes.error ?? 'Failed to create draft payment')
          }
          // The text is asked for with the LAST payment only: the server names what has been
          // posted for the whole group then, and texts the group once.
          const postRes = await postDraftPayment(draftRes.data.id, {
            sendSms: sendSms && srcIdx === sources.length - 1,
          })
          if (!postRes.success) {
            throw new Error(postRes.error ?? 'Failed to post payment')
          }
          if (postRes.smsError) smsError = postRes.smsError
          postedSourceIndices.push(srcIdx)
          postedPaymentIds.push(draftRes.data.id)
        }

        toast.success(
          `Posted ${sources.length} payment${sources.length > 1 ? 's' : ''} — total ${formatCurrency(sourceTotal)}`
        )
        if (smsError) {
          toast.warning(`Payment posted, but the confirmation text was not sent: ${smsError}`)
        }
        if (slipWindow && slipBasis) {
          slipHandedOver = true
          await printSlip(slipWindow, slipBasis)
        } else if (slipBasis) {
          toast.warning(
            'The browser blocked the outstanding-balance slip. Allow pop-ups for this site to print it.'
          )
        }
        // Any posted id works: the receipt endpoint gathers every payment that shares the
        // group, so a split still shows every method on the one slip.
        await showReceiptThenFinish(postedPaymentIds[0] ?? null)
      } catch (err) {
        const postedCount = postedSourceIndices.length
        if (postedCount > 0) {
          // Partial success — say what posted and still offer its receipt; the dialog finishes
          // (and refreshes the caller) once the receipt is dismissed, so posted payments are
          // visible and the user is not at risk of double-posting.
          toast.error(
            `${postedCount} of ${sources.length} payment${sources.length > 1 ? 's' : ''} posted — one failed: ${err instanceof Error ? err.message : 'Unknown error'}. Check the transactions list.`
          )
          await showReceiptThenFinish(postedPaymentIds[0] ?? null)
        } else {
          toast.error(err instanceof Error ? err.message : 'Failed to post payment')
        }
      } finally {
        // A window that was opened but never handed to the slip (the payment was refused, or
        // stopped part-way) must not be left behind blank.
        if (slipWindow && !slipHandedOver) slipWindow.close()
      }
    })
  }, [
    submit,
    printOutstanding,
    outstanding,
    printSlip,
    sources,
    sourcesUnderfunded,
    selectedInvoices,
    overspill,
    overspillSignificant,
    walletUnknown,
    walletOverdrawn,
    walletBalance,
    walletUsed,
    allocations,
    paymentDate,
    patientId,
    planId,
    appointmentId,
    sourceTotal,
    sendSms,
    showReceiptThenFinish,
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
                    {walletBalance !== null && walletBalance > 0 && (
                      <>
                        {' '}
                        Wallet credit available:{' '}
                        <strong className="text-emerald-700">
                          {formatCurrency(walletBalance)}
                        </strong>
                        .
                      </>
                    )}
                    {!loading && walletBalance === null && (
                      <span className="text-red-600"> Wallet credit could not be loaded.</span>
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
                    (walletBalance === null || walletUsed > walletBalance + 0.005)
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
                            {walletBalance === null
                              ? 'unavailable'
                              : formatCurrency(Math.max(0, walletBalance - walletUsed))}
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
              ) : loadFailed ? (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-3 p-4 text-sm text-destructive"
                >
                  <span>Couldn’t load this patient’s invoices, so none can be paid from here.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => dataQuery.refetch()}
                  >
                    Try again
                  </Button>
                </div>
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
                    const loadedLines = linesByInvoiceId[inv.id]
                    const displayItems = deriveInvoiceDisplayItems(
                      loadedLines?.ok ? loadedLines.lines : undefined,
                      inv.treatments
                    )
                    const linesFailed = lineItemsQuery.isError || (!!loadedLines && !loadedLines.ok)
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
                          {/* What the invoice is for: its lines, else the treatments recorded on a
                              legacy invoice. A failed read is said, not shown as "no items". */}
                          <div className="text-xs text-foreground">
                            {lineItemsQuery.isLoading ? (
                              'Loading treatments…'
                            ) : displayItems.length > 0 ? (
                              <ul className="space-y-0.5">
                                {displayItems.map((item, idx) => (
                                  <li
                                    // biome-ignore lint/suspicious/noArrayIndexKey: two lines can share a name and an amount
                                    key={`${idx}:${item.name}:${item.cost}`}
                                    className="flex items-baseline justify-between gap-2"
                                  >
                                    <span className="truncate" title={item.name}>
                                      {item.name}
                                    </span>
                                    <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                                      {formatCurrency(item.cost)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : linesFailed ? (
                              'Couldn’t load this invoice’s services'
                            ) : (
                              'No line items on this invoice'
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
              {/* Everything the patient owes, as the server works it out: more than the invoices on
                  this screen when only one is being paid. A figure that could not be read is said
                  so, never shown as zero. */}
              <div className="flex justify-between border-t pt-1">
                <span>
                  Patient total outstanding
                  {outstanding
                    ? ` (${outstanding.invoices.length} invoice${outstanding.invoices.length === 1 ? '' : 's'})`
                    : ''}
                </span>
                <span className="font-mono">
                  {loading
                    ? 'Loading…'
                    : outstanding
                      ? formatCurrency(outstanding.total)
                      : 'Couldn’t be loaded'}
                </span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="rp-print-outstanding"
                  checked={printOutstanding}
                  onCheckedChange={(checked) => setPrintOutstanding(checked === true)}
                  disabled={busy || !outstanding}
                />
                <Label htmlFor="rp-print-outstanding" className="text-xs font-normal">
                  Print total outstanding balance (separate from the payment receipt)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="rp-send-sms"
                  checked={sendSms}
                  onCheckedChange={(checked) => setSendSms(checked === true)}
                  disabled={busy}
                />
                <Label htmlFor="rp-send-sms" className="text-xs font-normal">
                  Text the patient a payment confirmation (SMS)
                </Label>
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
                loadFailed ||
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
      {/* The receipt of what was just posted, printed as soon as it shows. Dismissing it is what
          finishes the dialog (see `finalizeRef`). */}
      {receiptData && (
        <ReceiptViewDialog
          open={showReceiptDialog}
          onOpenChange={(o) => {
            setShowReceiptDialog(o)
            if (!o) {
              setReceiptData(null)
              const finalize = finalizeRef.current
              finalizeRef.current = null
              finalize?.()
            }
          }}
          receiptData={receiptData}
          autoPrint
        />
      )}
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
