import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IssueCreditNoteDialog } from '@/features/credit-notes/components/issue-credit-note-dialog'
import { RefundDialog } from '@/features/payments/components/refund-dialog'
import { ReversePaymentDialog } from '@/features/payments/components/reverse-payment-dialog'
import { type LedgerInvoice, listInvoices, voidInvoice } from '@/lib/actions/invoices-v2'
import { getPayments } from '@/lib/actions/payments'
import { getPatientsWithCredit, type PatientWithCredit } from '@/lib/actions/payments-v2'
import { usePermissions } from '@/lib/permissions-context'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { VoidDocumentDialog } from '@/shared/components/void-document-dialog'
import { useAsyncResource } from '@/shared/hooks/use-async-resource'
import { formatCurrency } from '@/shared/utils/currency'

// ── Shared row shapes ────────────────────────────────────────────────────────

/** A posted incoming patient payment that can be reversed. */
type ReversiblePayment = {
  id: string
  paymentNumber: string | null
  amount: number
  method: string
  status: string
  direction: string
  createdAt: string | Date
  patient?: { id: string; name: string } | null
}

export default function RefundsPage() {
  // Credit notes and invoice voids write down what a patient owes — admin-only.
  // Reversals stay open to reception (they undo a mis-keyed payment, and every
  // one is logged onto that day's report).
  const isAdmin = usePermissions()?.isAdmin ?? false

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Refunds &amp; Reversals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Three ways to give money back or undo a charge. Pick the one that matches the situation —
          each posts the correct accounting entry.
        </p>
      </header>

      <Tabs defaultValue="deposit-refunds" className="w-full">
        <TabsList>
          <TabsTrigger value="deposit-refunds">Deposit refunds</TabsTrigger>
          <TabsTrigger value="reversals">Payment reversals</TabsTrigger>
          {isAdmin && <TabsTrigger value="credit-notes">Credit notes &amp; voids</TabsTrigger>}
        </TabsList>

        <TabsContent value="deposit-refunds" className="mt-4">
          <DepositRefundsTab />
        </TabsContent>

        <TabsContent value="reversals" className="mt-4">
          <PaymentReversalsTab />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="credit-notes" className="mt-4">
            <CreditNotesTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

// ── Tab 1: Deposit refunds (cash back from unallocated credit) ───────────────

function DepositRefundsTab() {
  const { data, loading, error, refresh } =
    useAsyncResource<PatientWithCredit[]>(getPatientsWithCredit)
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<PatientWithCredit | null>(null)

  const rows = data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.patientCode ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Patients with unallocated credit (2200 Patient Deposits) who can receive a cash refund.
        Refunds post DR Patient Deposits / CR cash and reduce the patient&apos;s wallet.
      </p>

      <Input
        placeholder="Search by name or patient code"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      {error && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No patients with refundable credit.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Code</TableHead>
              <TableHead className="text-right">Credit balance</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.patientId}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.patientCode ?? '—'}
                </TableCell>
                <TableCell className="text-right font-mono">
                  <Badge variant="secondary">{formatCurrency(r.depositBalance)}</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" onClick={() => setTarget(r)}>
                    Refund
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {target && (
        <RefundDialog
          open={target !== null}
          onOpenChange={(o) => !o && setTarget(null)}
          patientId={target.patientId}
          patientName={target.name}
          onPosted={() => {
            setTarget(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

// ── Tab 2: Payment reversals (undo a posted payment) ─────────────────────────

function PaymentReversalsTab() {
  const fetchPosted = useCallback(async () => {
    const res = await getPayments()
    if (!res.success) return { success: false as const, error: res.error }
    // Only incoming, posted (GL-settled) patient payments can be reversed.
    // Refund payments (direction='outgoing') and already-reversed rows are out.
    const reversible = (res.data as ReversiblePayment[]).filter(
      (p) => (p.status === 'posted' || p.status === 'completed') && p.direction !== 'outgoing'
    )
    return { success: true as const, data: reversible }
  }, [])

  const { data, loading, error, refresh } = useAsyncResource<ReversiblePayment[]>(fetchPosted)
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<ReversiblePayment | null>(null)

  const rows = data ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        (r.patient?.name ?? '').toLowerCase().includes(q) ||
        (r.paymentNumber ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Posted patient payments. Reversing one posts a reversing journal entry, rolls back the
        invoice balance(s) it settled and any wallet credit it created, and flips the payment to{' '}
        <strong>reversed</strong>. Use this when a payment was recorded in error — not to reduce
        what a patient owes (issue a credit note for that).
      </p>

      <Input
        placeholder="Search by patient or payment number"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      {error && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No posted payments available to reverse.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payment</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.paymentNumber ?? '—'}</TableCell>
                <TableCell className="font-medium">{p.patient?.name ?? 'Unknown'}</TableCell>
                <TableCell className="capitalize text-sm text-muted-foreground">
                  {p.method.replace(/_/g, ' ')}
                </TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(p.amount)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setTarget(p)}>
                    Reverse
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {target && (
        <ReversePaymentDialog
          open={target !== null}
          onOpenChange={(o) => !o && setTarget(null)}
          paymentId={target.id}
          paymentLabel={target.paymentNumber}
          amount={target.amount}
          onReversed={() => {
            setTarget(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

// ── Tab 3: Credit notes & voids (reduce / cancel an invoice) ─────────────────

function CreditNotesTab() {
  // Issued + partially-paid invoices are the only ones with an actionable
  // credit-note / void path. Two filtered fetches merged into one list.
  const fetchInvoices = useCallback(async () => {
    const [issued, partial] = await Promise.all([
      listInvoices({ status: 'issued', limit: 200 }),
      listInvoices({ status: 'partially_paid', limit: 200 }),
    ])
    if (!issued.success && !partial.success) {
      return { success: false as const, error: issued.error ?? partial.error }
    }
    const merged = [...(issued.data ?? []), ...(partial.data ?? [])].sort((a, b) =>
      String(b.issueDate ?? '').localeCompare(String(a.issueDate ?? ''))
    )
    return { success: true as const, data: merged }
  }, [])

  const { data, loading, error, refresh } = useAsyncResource<LedgerInvoice[]>(fetchInvoices)
  const [search, setSearch] = useState('')
  const [creditTarget, setCreditTarget] = useState<LedgerInvoice | null>(null)
  const [voidTarget, setVoidTarget] = useState<LedgerInvoice | null>(null)

  const rows = data ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(q) ||
        (inv.patient?.name ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Issued and partially-paid invoices. A <strong>credit note</strong> reduces what the patient
        owes (write-off, discount, correction) and reverses the proportional tax.{' '}
        <strong>Void</strong> cancels an invoice that has no payments allocated to it.
      </p>

      <Input
        placeholder="Search by invoice number or patient"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      {error && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No issued or partially-paid invoices.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="w-56" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="font-mono text-xs font-semibold">
                  {inv.invoiceNumber}
                </TableCell>
                <TableCell className="font-medium">{inv.patient?.name ?? 'Unknown'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {String(inv.status).replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(Number(inv.balance))}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button size="sm" onClick={() => setCreditTarget(inv)}>
                    Credit note
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setVoidTarget(inv)}>
                    Void
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {creditTarget && (
        <IssueCreditNoteDialog
          open={creditTarget !== null}
          onOpenChange={(o) => !o && setCreditTarget(null)}
          invoiceId={creditTarget.id}
          invoiceNumber={creditTarget.invoiceNumber}
          invoiceBalance={Number(creditTarget.balance)}
          invoiceTaxTotal={Number(creditTarget.taxTotal)}
          invoiceTotal={Number(creditTarget.total)}
          onPosted={() => {
            setCreditTarget(null)
            refresh()
          }}
        />
      )}

      {voidTarget && (
        <VoidDocumentDialog
          open={voidTarget !== null}
          onOpenChange={(o) => !o && setVoidTarget(null)}
          documentLabel="invoice"
          description="Posts a reversal entry. Allowed only when no payments are allocated to this invoice. Use a credit note for invoices that already have payments."
          onConfirm={async (reason) => {
            if (!voidTarget) return false
            const res = await voidInvoice(voidTarget.id, reason)
            if (!res.success) {
              toast.error(res.error ?? 'Failed to void invoice')
              return false
            }
            toast.success('Invoice voided')
            setVoidTarget(null)
            refresh()
            return true
          }}
        />
      )}
    </div>
  )
}
