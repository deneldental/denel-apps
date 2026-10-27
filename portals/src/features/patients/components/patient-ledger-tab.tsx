import { format } from 'date-fns'
import {
  Archive,
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  Eye,
  MoreHorizontal,
  Plus,
  Printer,
  Receipt,
  Wallet as WalletIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArchiveConfirmationDialog } from '@/features/patients/components/archive-confirmation-dialog'
import { ArchivedTab } from '@/features/patients/components/archived-tab'
import type {
  CompletedPayment,
  CompletedPaymentAllocation,
  OutstandingInvoice,
  PatientLedger,
  WalletCreditTransaction,
} from '@/features/patients/types/ledger'
import { PaymentPlanSheet } from '@/features/payment-plans/components/payment-plan-sheet'
import { InvoiceViewSheet } from '@/features/payments/components/invoice-view-sheet'
import { ReceiptViewDialog } from '@/features/payments/components/receipt-view-dialog'
import { ReceivePaymentDialog } from '@/features/payments/components/receive-payment-dialog'
import { WalletTopUpDialog } from '@/features/payments/components/wallet-topup-dialog'
import { archiveInvoice, listInvoiceLines } from '@/lib/actions/invoices-v2'
import { archivePaymentPlan, deletePaymentPlan } from '@/lib/actions/payment-plans'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { formatCurrency, formatCurrencyCompact } from '@/shared/utils/currency'

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  patientId: string
  isAdmin?: boolean
  /** Fires every time the ledger is (re)loaded — lets parents (e.g. the
   *  patient bio pin) keep their copy of `outstandingBalance` in sync with
   *  payments posted from inside this tab without a manual refresh. */
  onLedgerChange?: (ledger: PatientLedger) => void
}

export function PatientLedgerTab({ patientId, isAdmin = false, onLedgerChange }: Props) {
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const [walletTopUpOpen, setWalletTopUpOpen] = useState(false)
  const [outstandingModalOpen, setOutstandingModalOpen] = useState(false)
  // Receive-payment dialog scoped to a single invoice (opened by clicking a
  // row in the outstanding modal or invoices tab).
  const [receiveForInvoice, setReceiveForInvoice] = useState<string | null>(null)

  // Payment plans tab — lazy: only fetched once the Plans tab is actually opened.
  const [plansTabOpened, setPlansTabOpened] = useState(false)

  // Same key + endpoint the estimate-confirmation sheet's wallet-balance read
  // uses — sharing it means a payment/credit posted from either screen
  // refreshes the other's view of this patient's ledger.
  const ledgerQuery = useApiQuery<PatientLedger>(queryKeys.patients.balance(patientId), () =>
    api.get<PatientLedger>(`/api/patients/${patientId}/ledger`)
  )
  const ledger = ledgerQuery.data ?? null
  const loading = ledgerQuery.isLoading
  const error = ledgerQuery.isError ? ledgerQuery.error.message : null

  // Refresh ledger after any payment / credit action.
  const refreshLedger = async () => {
    await ledgerQuery.refetch()
  }

  useEffect(() => {
    if (ledger) onLedgerChange?.(ledger)
  }, [ledger, onLedgerChange])

  // Same underlying endpoint getPaymentPlanByPatientId() calls (an array of
  // every plan for this patient) — kept on its own key rather than
  // queryKeys.paymentPlans.patient() to avoid a cache-shape collision with
  // that hook's derived { plan, outstandingBalance } shape.
  const plansQuery = useApiQuery<any[]>(
    ['payment-plans', 'patient', patientId, 'list'] as const,
    () => api.get<any[]>(`/api/payment-plans/patient/${patientId}`),
    { enabled: plansTabOpened }
  )
  const paymentPlans = plansQuery.data ?? []
  const plansLoading = plansQuery.isLoading

  function loadPlans(force = false) {
    if (force) {
      void plansQuery.refetch()
    } else {
      setPlansTabOpened(true)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-[170px] animate-pulse rounded-2xl bg-muted" />
          <div className="h-[170px] animate-pulse rounded-2xl bg-muted" />
        </div>
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (error || !ledger) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        {error ?? 'Unable to load patient ledger'}
      </div>
    )
  }

  const {
    patientName = '',
    walletBalance,
    walletCreditTransactions = [],
    outstandingBalance,
    outstandingInvoices = [],
    completedPayments = [],
  } = ledger

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-6">
        {/* ── Cards ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button type="button" className="text-left" onClick={() => setWalletModalOpen(true)}>
            <WalletCard balance={walletBalance} />
          </button>
          <button type="button" className="text-left" onClick={() => setOutstandingModalOpen(true)}>
            <OutstandingCard balance={outstandingBalance} />
          </button>
        </div>

        {/* Per-plan progress lives inside each plan card on the Plans tab —
            no aggregated bar here because a patient may have multiple plans
            and the segments would conflate independent schedules. */}

        {/* ── Tabs ─────────────────────────────────────────────── */}
        <Tabs
          defaultValue="invoices"
          onValueChange={(v) => {
            if (v === 'plans') loadPlans(false)
          }}
        >
          <TabsList>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="plans">Payment Plans</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>

          {/* Tab 1: non-paid invoices */}
          <TabsContent value="invoices" className="mt-4">
            <InvoicesTab
              invoices={outstandingInvoices}
              isAdmin={isAdmin}
              patientName={patientName}
              onRowClick={(invId) => setReceiveForInvoice(invId)}
              onRefresh={refreshLedger}
            />
          </TabsContent>

          {/* Tab 2: completed payments */}
          <TabsContent value="transactions" className="mt-4">
            <TransactionsTab payments={completedPayments} />
          </TabsContent>

          {/* Tab 3: payment plans */}
          <TabsContent value="plans" className="mt-4">
            <PaymentPlansTab
              plans={paymentPlans}
              loading={plansLoading}
              onRefresh={() => loadPlans(true)}
              patientId={patientId}
            />
          </TabsContent>

          {/* Tab 4: archived invoices + plans (combined, filterable). */}
          <TabsContent value="archived" className="mt-4">
            <ArchivedTab patientId={patientId} isAdmin={isAdmin} onRefresh={refreshLedger} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Wallet modal */}
      <WalletModal
        open={walletModalOpen}
        onOpenChange={setWalletModalOpen}
        transactions={walletCreditTransactions}
        balance={walletBalance}
        onTopUp={() => setWalletTopUpOpen(true)}
      />

      {/* Wallet top-up dialog */}
      <WalletTopUpDialog
        open={walletTopUpOpen}
        onOpenChange={setWalletTopUpOpen}
        patientId={patientId}
        patientName={patientName}
        currentBalance={walletBalance}
        onPosted={refreshLedger}
      />

      {/* Outstanding modal */}
      <OutstandingModal
        open={outstandingModalOpen}
        onOpenChange={setOutstandingModalOpen}
        invoices={outstandingInvoices}
        balance={outstandingBalance}
        walletBalance={walletBalance}
        onRowClick={(invId) => {
          setOutstandingModalOpen(false)
          setReceiveForInvoice(invId)
        }}
      />

      {/* Single-invoice receive-payment dialog (opened by clicking an invoice
          row in either the outstanding modal or the invoices tab). */}
      {receiveForInvoice && (
        <ReceivePaymentDialog
          open={!!receiveForInvoice}
          onOpenChange={(o) => !o && setReceiveForInvoice(null)}
          patientId={patientId}
          invoiceId={receiveForInvoice}
          onPosted={async () => {
            setReceiveForInvoice(null)
            await refreshLedger()
          }}
        />
      )}
    </TooltipProvider>
  )
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function CardFace({
  gradientClass,
  label,
  balance,
  footerLeft,
  footerRight,
  icon,
}: {
  gradientClass: string
  label: string
  balance: number
  footerLeft?: string
  footerRight?: string
  icon: React.ReactNode
}) {
  return (
    <div
      className={`relative h-[170px] overflow-hidden rounded-2xl text-white shadow-lg cursor-pointer hover:shadow-xl transition-shadow ${gradientClass}`}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-black/10 blur-2xl" />
      <div className="relative flex h-full flex-col justify-between px-5 py-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
              {icon}
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/90">
              {label}
            </p>
          </div>
          <CreditCard className="h-5 w-5 text-white/70" />
        </div>
        <p
          className="text-5xl font-black tabular-nums leading-none tracking-tight"
          title={formatCurrency(balance)}
        >
          {formatCurrencyCompact(balance)}
        </p>
        <div className="flex items-end justify-between gap-3">
          <p className="text-[10px] uppercase tracking-wider text-white/70">{footerLeft}</p>
          <p className="shrink-0 text-[10px] uppercase tracking-wider text-white/70">
            {footerRight}
          </p>
        </div>
      </div>
    </div>
  )
}

function WalletCard({ balance }: { balance: number }) {
  return (
    <CardFace
      gradientClass="bg-gradient-to-br from-emerald-500 via-teal-600 to-teal-800"
      label="Wallet"
      balance={balance}
      footerLeft="Clinic credit"
      footerRight="Click to view"
      icon={<WalletIcon className="h-3.5 w-3.5 text-white" />}
    />
  )
}

function OutstandingCard({ balance }: { balance: number }) {
  return (
    <CardFace
      gradientClass="bg-gradient-to-br from-rose-500 via-red-600 to-red-800"
      label="Outstanding"
      balance={balance}
      footerLeft={balance <= 0 ? "You're settled" : 'Amount due'}
      footerRight={balance <= 0 ? 'No balance due' : 'Click to view'}
      icon={
        balance <= 0 ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-white" />
        ) : (
          <ArrowUpRight className="h-3.5 w-3.5 text-white" />
        )
      }
    />
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function WalletModal({
  open,
  onOpenChange,
  transactions,
  balance,
  onTopUp,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  transactions: WalletCreditTransaction[]
  balance: number
  onTopUp: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Wallet — {formatCurrency(balance)}</DialogTitle>
            <Button
              size="sm"
              onClick={() => {
                onOpenChange(false)
                onTopUp()
              }}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Top up
            </Button>
          </div>
        </DialogHeader>
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <WalletIcon className="h-8 w-8 text-muted-foreground/40" />
            {balance <= 0 ? (
              <>
                <p className="text-sm font-medium">No wallet balance</p>
                <p className="text-xs text-muted-foreground">
                  This patient has no credit on file. Use <strong>Top up</strong> to add some.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No credit transactions yet — wallet balance was set directly.
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Active top-ups that make up the current balance. Older credits drop off the list once
              they've been fully drawn down by debits.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => {
                  const partial = t.originalAmount > t.amount
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(t.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">
                          {WALLET_SOURCE_LABEL[t.sourceType] ?? t.sourceType.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{t.description}</TableCell>
                      <TableCell className="text-right text-sm font-medium text-emerald-600 tabular-nums">
                        +{formatCurrencyCompact(t.amount)}
                        {partial && (
                          <div className="text-[10px] text-muted-foreground font-normal">
                            of {formatCurrencyCompact(t.originalAmount)}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Friendly labels for wallet credit source types. The raw values come from
// `wallet_transactions.sourceType` ('payment' | 'adjustment' | 'refund' | ...).
const WALLET_SOURCE_LABEL: Record<string, string> = {
  payment: 'Top-up',
  adjustment: 'Adjustment',
  refund: 'Refund',
  invoice_charge: 'Charge',
}

function OutstandingModal({
  open,
  onOpenChange,
  invoices,
  balance,
  walletBalance,
  onRowClick,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  invoices: OutstandingInvoice[]
  balance: number
  walletBalance: number
  onRowClick: (invoiceId: string) => void
}) {
  const STATUS_CLASS: Record<string, string> = {
    pending: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30',
    partial: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/30',
    partially_paid:
      'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/30',
    issued: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30',
    overdue: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30',
  }
  const hasCredit = walletBalance > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Outstanding — {formatCurrency(balance)}</DialogTitle>
        </DialogHeader>
        {hasCredit && invoices.length > 0 && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            Wallet credit available: <strong>{formatCurrency(walletBalance)}</strong>. Click an
            invoice — the receive-payment dialog includes <strong>Wallet credit</strong> as a
            payment option (combine it with cash/MoMo for split payments).
          </p>
        )}
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No outstanding invoices.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => onRowClick(inv.id)}
                >
                  <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-4 px-1.5 capitalize ${STATUS_CLASS[inv.status] ?? ''}`}
                    >
                      {inv.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium text-red-500 tabular-nums">
                    {formatCurrencyCompact(inv.balance)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Tab 1: Invoices ──────────────────────────────────────────────────────────

function InvoicesTab({
  invoices,
  isAdmin: _isAdmin,
  patientName,
  onRowClick,
  onRefresh,
}: {
  invoices: OutstandingInvoice[]
  isAdmin: boolean
  patientName: string
  onRowClick: (invoiceId: string) => void
  onRefresh: () => Promise<void>
}) {
  const STATUS_CLASS: Record<string, string> = {
    pending: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400',
    partial: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400',
    partially_paid: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400',
    issued: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400',
    overdue: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400',
  }

  /** Local state for the View/Print invoice dialog opened from the row's
   *  three-dots action. `autoPrint` differentiates the two menu items —
   *  View opens the dialog only, Print opens it AND triggers print. */
  const [viewing, setViewing] = useState<{ id: string; autoPrint: boolean } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<OutstandingInvoice | null>(null)

  async function handleArchiveInvoice() {
    if (!archiveTarget) return
    const res = await archiveInvoice(archiveTarget.id)
    if (res.success) {
      toast.success(`Invoice ${archiveTarget.invoiceNumber} archived`)
      setArchiveTarget(null)
      await onRefresh()
    } else {
      toast.error(res.error || 'Failed to archive invoice')
      throw new Error(res.error || 'archive failed')
    }
  }

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
        <Receipt className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No outstanding invoices</p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => (
              <TableRow
                key={inv.id}
                className="cursor-pointer hover:bg-muted/40"
                onClick={() => onRowClick(inv.id)}
              >
                <TableCell className="font-mono text-xs font-semibold">
                  {inv.invoiceNumber}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-[10px] h-4 px-1.5 capitalize ${STATUS_CLASS[inv.status] ?? ''}`}
                  >
                    {inv.status.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '—'}
                </TableCell>
                <TableCell
                  className="text-right text-sm tabular-nums"
                  title={formatCurrency(inv.amount)}
                >
                  {formatCurrencyCompact(inv.amount)}
                </TableCell>
                <TableCell
                  className="text-right text-sm font-medium text-red-500 tabular-nums"
                  title={formatCurrency(inv.balance)}
                >
                  {formatCurrencyCompact(inv.balance)}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="More options"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setViewing({ id: inv.id, autoPrint: false })}
                      >
                        <Eye className="mr-2 h-4 w-4" /> View invoice
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setViewing({ id: inv.id, autoPrint: true })}
                      >
                        <Printer className="mr-2 h-4 w-4" /> Print invoice
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setArchiveTarget(inv)}
                      >
                        <Archive className="mr-2 h-4 w-4" /> Archive invoice…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {viewing && (
        <InvoiceViewSheet
          open={!!viewing}
          onOpenChange={(o) => !o && setViewing(null)}
          invoiceId={viewing.id}
          autoPrint={viewing.autoPrint}
          patientName={patientName}
        />
      )}

      <ArchiveConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        onConfirm={handleArchiveInvoice}
        title="Archive invoice?"
        description="The invoice moves to the Archived tab and stops appearing in active lists, reports, and outstanding-balance calculations."
        itemName={archiveTarget?.invoiceNumber}
        warning="Every transaction (payment / allocation) attached to this invoice will be hidden from the active ledger view too."
      />
    </>
  )
}

// ─── Tab 2: Transactions ──────────────────────────────────────────────────────

interface ReceiptData {
  patientName: string
  appointmentDate?: string
  amountPaid: number
  totalAmount?: number
  balance?: number
  paymentType: string
  paymentFor: string
  notes?: string | null
  clinicName: string
  clinicPhone?: string | null
  clinicAddress?: string | null
  clinicWebsite?: string | null
  generatedAt: string
  allocations?: Array<{
    invoiceNumber: string
    invoiceTotal: number | null
    amountApplied: number
    remainingBalance: number | null
    status: string | null
    treatments?: string[]
  }>
  methods?: Array<{
    method: string
    amount: number
    reference: string | null
    paymentNumber: string | null
  }>
  unallocatedAmount?: number
  paymentNumber?: string | null
  paymentNumbers?: string[]
  invoiceNumbers?: string[]
}

type DisplayPayment = CompletedPayment & { isMulti: boolean }

// A split (multi-method) payment writes one `payments` row per funding
// source, all sharing one `paymentGroupId` — the receipt endpoint already
// merges those into one receipt, so the ledger table merges them into one
// row too instead of showing a row per method.
function groupPaymentsForDisplay(payments: CompletedPayment[]): DisplayPayment[] {
  const groups = new Map<string, CompletedPayment[]>()
  const rows: DisplayPayment[] = []

  for (const p of payments) {
    if (!p.paymentGroupId) {
      rows.push({ ...p, isMulti: false })
      continue
    }
    const arr = groups.get(p.paymentGroupId) ?? []
    arr.push(p)
    groups.set(p.paymentGroupId, arr)
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      rows.push({ ...group[0], isMulti: false })
      continue
    }
    const [first] = group
    const mergedAllocs = new Map<string, CompletedPaymentAllocation>()
    for (const g of group) {
      for (const a of g.allocatedInvoices ?? []) {
        const existing = mergedAllocs.get(a.invoiceNumber)
        mergedAllocs.set(
          a.invoiceNumber,
          existing ? { ...existing, amountApplied: existing.amountApplied + a.amountApplied } : a
        )
      }
    }
    rows.push({
      id: first.id,
      paymentNumber:
        group
          .map((g) => g.paymentNumber)
          .filter(Boolean)
          .join(', ') || null,
      paymentGroupId: first.paymentGroupId,
      amount: group.reduce((sum, g) => sum + g.amount, 0),
      allocatedAmount: group.reduce((sum, g) => sum + (g.allocatedAmount ?? 0), 0),
      unallocatedAmount: group.reduce((sum, g) => sum + (g.unallocatedAmount ?? 0), 0),
      method: 'multi',
      description: first.description,
      status: first.status,
      isRefund: group.some((g) => g.isRefund),
      createdAt: first.createdAt,
      allocatedInvoices: Array.from(mergedAllocs.values()),
      isMulti: true,
    })
  }

  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

function TransactionsTab({ payments }: { payments: CompletedPayment[] }) {
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false)
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function openReceipt(payment: CompletedPayment, print = false) {
    setLoadingId(payment.id)
    const res = await api.get<ReceiptData>(`/api/payments/${payment.id}/receipt`)
    setLoadingId(null)
    if (!res.success || !res.data) {
      toast.error('Failed to load receipt')
      return
    }
    setReceiptData(res.data)
    setAutoPrintReceipt(print)
    setReceiptOpen(true)
  }

  if (payments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
        <Receipt className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No completed payments yet</p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupPaymentsForDisplay(payments).map((p) => {
              const allocs = p.allocatedInvoices ?? []
              const isPartial = allocs.some((a) => a.status === 'partially_paid')
              const isPaid = allocs.length > 0 && allocs.every((a) => a.status === 'paid')
              return (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => openReceipt(p)}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(p.createdAt), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="text-sm capitalize">
                    {p.isMulti ? 'Multi' : p.method.replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell className="text-sm max-w-[260px]">
                    <div className="truncate">{p.description ?? p.paymentNumber ?? '—'}</div>
                    {allocs.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        <span>→</span>
                        {allocs.map((a) => (
                          <span
                            key={a.invoiceNumber}
                            className="font-mono inline-flex items-center gap-1 rounded bg-muted px-1 py-0.5"
                          >
                            {a.invoiceNumber}
                            <span className="text-foreground">
                              {formatCurrencyCompact(a.amountApplied)}
                            </span>
                          </span>
                        ))}
                        {isPartial && (
                          <Badge
                            variant="outline"
                            className="h-3.5 px-1 text-[9px] border-blue-300 text-blue-700"
                          >
                            Partial
                          </Badge>
                        )}
                        {isPaid && (
                          <Badge
                            variant="outline"
                            className="h-3.5 px-1 text-[9px] border-emerald-300 text-emerald-700"
                          >
                            Paid
                          </Badge>
                        )}
                      </div>
                    )}
                    {(p.unallocatedAmount ?? 0) > 0 && (
                      <div className="text-[10px] text-emerald-700">
                        → Credit: {formatCurrencyCompact(p.unallocatedAmount)}
                      </div>
                    )}
                    {p.isRefund && (
                      <Badge variant="outline" className="ml-2 text-[10px] h-4 px-1">
                        Refund
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right text-sm font-medium tabular-nums text-emerald-600"
                    title={formatCurrency(p.amount)}
                  >
                    +{formatCurrencyCompact(p.amount)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={loadingId === p.id}
                          aria-label="More options"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openReceipt(p)}>
                          <Eye className="mr-2 h-4 w-4" /> View receipt
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openReceipt(p, true)}>
                          <Printer className="mr-2 h-4 w-4" /> Print receipt
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {receiptData && (
        <ReceiptViewDialog
          open={receiptOpen}
          onOpenChange={(o) => {
            setReceiptOpen(o)
            if (!o) {
              setAutoPrintReceipt(false)
              setReceiptData(null)
            }
          }}
          receiptData={receiptData}
          autoPrint={autoPrintReceipt}
        />
      )}
    </>
  )
}

// ─── Tab 3: Payment Plans ─────────────────────────────────────────────────────

function PaymentPlansTab({
  plans,
  loading,
  onRefresh,
  patientId,
}: {
  plans: any[]
  loading: boolean
  onRefresh: () => void | Promise<void>
  patientId: string
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [receiveFor, setReceiveFor] = useState<{ planId: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; label: string } | null>(null)
  /** Plan whose detail card is open in the row-click dialog. */
  const [detailPlan, setDetailPlan] = useState<any | null>(null)

  async function handleDeletePlan() {
    if (!deleteTarget) return
    const res = await deletePaymentPlan(deleteTarget.id)
    if (res.success) {
      toast.success('Plan deleted')
      setDeleteTarget(null)
      onRefresh()
    } else {
      // Surface the backend's specific reason — e.g. "Plan has active invoices"
      // with the invoice numbers — so the user knows what to void first.
      const detail = (res as { details?: string }).details
      toast.error(detail ? `${res.error}: ${detail}` : res.error || 'Failed to delete plan')
    }
  }

  async function handleArchivePlan() {
    if (!archiveTarget) return
    const res = await archivePaymentPlan(archiveTarget.id)
    if (res.success) {
      toast.success(`Plan ${archiveTarget.label} archived`)
      setArchiveTarget(null)
      await onRefresh()
    } else {
      toast.error(res.error || 'Failed to archive plan')
      throw new Error(res.error || 'archive failed')
    }
  }

  async function handleStatusChange(planId: string, status: string) {
    const res = await api.patch(`/api/payment-plans/${planId}`, { status })
    if (res.success) {
      toast.success(`Plan ${status}`)
      onRefresh()
    } else {
      toast.error('Failed to update plan')
    }
  }

  const STATUS_CLASS: Record<string, string> = {
    activated: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400',
    overdue: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400',
    paused: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400',
    completed: 'text-slate-600 bg-slate-100 border-slate-200 dark:text-slate-400',
    outstanding: 'text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-400',
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button size="sm" onClick={() => setSheetOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New plan
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
          <CreditCard className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No payment plans yet</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Per installment</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead className="text-right">Progress</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => {
                const pct = planProgressPct(plan)
                return (
                  <TableRow
                    key={plan.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setDetailPlan(plan)}
                  >
                    <TableCell className="font-mono text-xs font-semibold">
                      {plan.planNumber ?? `PLAN-${String(plan.id).slice(0, 8)}`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground capitalize">
                      {plan.type}
                      {plan.template?.name ? (
                        <span className="block text-[10px] truncate max-w-[140px]">
                          {plan.template.name}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-4 px-1.5 capitalize ${STATUS_CLASS[plan.status] ?? ''}`}
                      >
                        {plan.status}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="text-right text-sm tabular-nums"
                      title={formatCurrency(plan.totalAmount)}
                    >
                      {formatCurrencyCompact(plan.totalAmount)}
                    </TableCell>
                    <TableCell
                      className="text-right text-sm tabular-nums text-muted-foreground"
                      title={
                        plan.amountPerInstallment != null
                          ? formatCurrency(plan.amountPerInstallment)
                          : ''
                      }
                    >
                      {plan.amountPerInstallment != null
                        ? formatCurrencyCompact(plan.amountPerInstallment)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs capitalize text-muted-foreground">
                      {plan.paymentFrequency ?? '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-sky-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground">{Number(pct).toFixed(0)}%</span>
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="More options"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setDetailPlan(plan)}>
                            <Eye className="mr-2 h-4 w-4" /> View details
                          </DropdownMenuItem>
                          {plan.status !== 'completed' && (
                            <DropdownMenuItem onSelect={() => setReceiveFor({ planId: plan.id })}>
                              Receive payment
                            </DropdownMenuItem>
                          )}
                          {(plan.status === 'activated' || plan.status === 'overdue') && (
                            <DropdownMenuItem
                              onSelect={() => handleStatusChange(plan.id, 'paused')}
                            >
                              Pause plan
                            </DropdownMenuItem>
                          )}
                          {plan.status === 'paused' && (
                            <DropdownMenuItem
                              onSelect={() => handleStatusChange(plan.id, 'activated')}
                            >
                              Resume plan
                            </DropdownMenuItem>
                          )}
                          {plan.status === 'outstanding' && (
                            <DropdownMenuItem
                              onSelect={() => handleStatusChange(plan.id, 'activated')}
                            >
                              Reactivate plan
                            </DropdownMenuItem>
                          )}
                          {['activated', 'paused', 'overdue'].includes(plan.status) && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => handleStatusChange(plan.id, 'outstanding')}
                            >
                              Cancel plan
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() =>
                              setArchiveTarget({
                                id: plan.id,
                                label: plan.planNumber ?? `${plan.type} plan`,
                              })
                            }
                          >
                            <Archive className="mr-2 h-4 w-4" /> Archive plan…
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() =>
                              setDeleteTarget({
                                id: plan.id,
                                label: plan.planNumber ?? `${plan.type} plan`,
                              })
                            }
                          >
                            Delete plan…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <PaymentPlanSheet
        patientId={patientId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSuccess={onRefresh}
      />

      {receiveFor && (
        <ReceivePaymentDialog
          open={!!receiveFor}
          onOpenChange={(o) => !o && setReceiveFor(null)}
          patientId={patientId}
          planId={receiveFor.planId}
          onPosted={() => {
            setReceiveFor(null)
            onRefresh()
          }}
        />
      )}

      {/* Row-click detail dialog — renders the same PlanDetails + PlanProgress
          card we used to inline on the grid, just inside a modal so the
          datatable rows stay scannable. */}
      <Dialog open={!!detailPlan} onOpenChange={(o) => !o && setDetailPlan(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailPlan && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-sm">
                    {detailPlan.planNumber ?? `PLAN-${String(detailPlan.id).slice(0, 8)}`}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] h-4 px-1.5 capitalize ${STATUS_CLASS[detailPlan.status] ?? ''}`}
                  >
                    {detailPlan.status}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  Treatments, cadence, and progress for this payment plan.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <PlanDetails plan={detailPlan} />
                <PlanProgress plan={detailPlan} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={handleDeletePlan}
        title="Delete payment plan?"
        description="Deletes the plan and its schedule. Only allowed if no active invoices are attached — void any open invoices first. This cannot be undone."
        itemName={deleteTarget?.label}
      />

      <ArchiveConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        onConfirm={handleArchivePlan}
        title="Archive payment plan?"
        description="The plan moves to the Archived tab and disappears from active lists, the bio pane, and reports. Its invoices stay in the database for history."
        itemName={archiveTarget?.label}
      />
    </>
  )
}

/** Shared progress calculator for the plans datatable + the detail dialog.
 *  Live invoices = not void / written off; sum their `paidAmount` over the
 *  plan total. Mirrors what `PlanProgress` does internally. */
function planProgressPct(plan: any): number {
  const total = Number(plan.totalAmount) || 0
  if (total <= 0) return 0
  const planInvoices: Array<{ status?: string; paidAmount?: number | string }> = Array.isArray(
    plan.invoices
  )
    ? plan.invoices
    : []
  const live = planInvoices.filter((inv) => inv.status !== 'void' && inv.status !== 'written_off')
  let paid = live.reduce((sum, inv) => sum + Number(inv.paidAmount ?? 0), 0)
  if (live.length === 0 && plan.status === 'completed') paid = total
  return Math.min(100, Math.max(0, (paid / total) * 100))
}

// ─── Plan details ────────────────────────────────────────────────────────────
// Surfaces every input from plan creation on the card itself:
//   - treatment line items (from the master invoice)
//   - cadence (per-installment, count, frequency)
//   - start / end dates
//   - notes

function PlanDetails({ plan }: { plan: any }) {
  type LineRow = {
    description: string
    quantity: number | string
    unitPrice: number | string
    discountAmount: number | string
    lineTotal: number | string
  }
  // Prefer the bulk-fetched lines from /payment-plans/patient/:id (fast path).
  // Fall back to a per-plan lazy fetch so the UI works even if the backend
  // hasn't been restarted with the enrichment change yet.
  const embeddedLines: LineRow[] = Array.isArray(plan.masterInvoiceLines)
    ? (plan.masterInvoiceLines as LineRow[])
    : []
  const [lazyLines, setLazyLines] = useState<LineRow[] | null>(null)
  useEffect(() => {
    if (embeddedLines.length > 0) return
    if (!plan.invoiceId) return
    let active = true
    listInvoiceLines(plan.invoiceId as string).then((res) => {
      if (!active) return
      if (res.success && res.data) {
        setLazyLines(
          res.data.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountAmount: l.discountAmount,
            lineTotal: l.lineTotal,
          }))
        )
      }
    })
    return () => {
      active = false
    }
  }, [embeddedLines.length, plan.invoiceId])
  const lines: LineRow[] = embeddedLines.length > 0 ? embeddedLines : (lazyLines ?? [])

  const fmtDate = (d: string | Date | null | undefined) => {
    if (!d) return null
    try {
      return format(new Date(d), 'MMM d, yyyy')
    } catch {
      return null
    }
  }
  const start = fmtDate(plan.startDate)
  const end = fmtDate(plan.endDate)

  return (
    <div className="space-y-3 text-xs">
      {/* Treatments — pulled from the master invoice's line items so the same
          breakdown you saw in the create-plan dialog is visible on the card. */}
      {lines.length > 0 && (
        <div>
          <p className="text-muted-foreground uppercase tracking-wide text-[10px] mb-1">
            Treatments
          </p>
          <ul className="space-y-0.5">
            {lines.map((line, idx) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: invoice_lines order is stable, no id needed
                key={idx}
                className="flex items-baseline justify-between gap-2"
              >
                <span className="truncate">
                  {Number(line.quantity) > 1 && (
                    <span className="text-muted-foreground">{Number(line.quantity)}× </span>
                  )}
                  {line.description}
                  {Number(line.discountAmount) > 0 && (
                    <span className="ml-1 text-[10px] text-emerald-600">
                      (−{formatCurrencyCompact(Number(line.discountAmount))})
                    </span>
                  )}
                </span>
                <span className="font-mono tabular-nums shrink-0">
                  {formatCurrencyCompact(Number(line.lineTotal))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Money + cadence in a compact grid. */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-muted-foreground uppercase tracking-wide text-[10px]">Total</p>
          <p className="font-semibold tabular-nums mt-0.5" title={formatCurrency(plan.totalAmount)}>
            {formatCurrencyCompact(plan.totalAmount)}
          </p>
        </div>
        {Number(plan.discountAmount ?? 0) > 0 && (
          <div>
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">Discount</p>
            <p className="font-semibold tabular-nums mt-0.5 text-emerald-700">
              −{formatCurrencyCompact(Number(plan.discountAmount))}
            </p>
          </div>
        )}
        {plan.amountPerInstallment != null && (
          <div>
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
              /installment
            </p>
            <p className="font-semibold tabular-nums mt-0.5">
              {formatCurrencyCompact(plan.amountPerInstallment)}
            </p>
          </div>
        )}
        {plan.numberOfInstallments != null && (
          <div>
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
              Installments
            </p>
            <p className="font-semibold mt-0.5">{plan.numberOfInstallments}</p>
          </div>
        )}
        {plan.paymentFrequency && (
          <div>
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">Frequency</p>
            <p className="font-semibold mt-0.5 capitalize">{plan.paymentFrequency}</p>
          </div>
        )}
        {start && (
          <div>
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">Start</p>
            <p className="font-semibold mt-0.5">{start}</p>
          </div>
        )}
        {end && (
          <div>
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">End</p>
            <p className="font-semibold mt-0.5">{end}</p>
          </div>
        )}
      </div>

      {plan.notes && (
        <div>
          <p className="text-muted-foreground uppercase tracking-wide text-[10px] mb-0.5">Notes</p>
          <p className="text-xs italic text-muted-foreground line-clamp-3">{plan.notes}</p>
        </div>
      )}
    </div>
  )
}

// ─── Per-plan progress ───────────────────────────────────────────────────────
// Tiny progress bar shown inside each plan card. Computes paid / total off the
// plan's eagerly-loaded invoices (skipping voided ones). Falls back gracefully
// when the relation isn't populated (older plan rows).

function PlanProgress({ plan }: { plan: any }) {
  const total = Number(plan.totalAmount) || 0
  const planInvoices: Array<{
    status: string
    paidAmount: number | string
    balance: number | string | null
    amount: number | string
  }> = Array.isArray(plan.invoices) ? plan.invoices : []

  const liveInvoices = planInvoices.filter(
    (inv) => inv.status !== 'void' && inv.status !== 'written_off'
  )
  let paid = liveInvoices.reduce((sum, inv) => sum + Number(inv.paidAmount ?? 0), 0)
  // For plans with no invoice rows yet (e.g. legacy / unissued), fall back to
  // the difference between plan total and a derived outstanding (0 in that case).
  if (liveInvoices.length === 0 && plan.status === 'completed') paid = total

  const pct = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0
  const isComplete = pct >= 100
  const remaining = Math.max(0, total - paid)

  return (
    <div className="mt-3 space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          Paid <span className="font-mono text-foreground">{formatCurrencyCompact(paid)}</span> of{' '}
          <span className="font-mono">{formatCurrencyCompact(total)}</span>
        </span>
        <span className="tabular-nums">{Number(pct).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-[width] ${isComplete ? 'bg-emerald-500' : 'bg-sky-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {remaining > 0 && !isComplete && (
        <p className="text-[10px] text-muted-foreground">
          Remaining:{' '}
          <span className="font-mono text-red-600">{formatCurrencyCompact(remaining)}</span>
        </p>
      )}
    </div>
  )
}
