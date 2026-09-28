import { centsToInput, formatCurrency, formatCurrencyCompact, inputToCents } from '@denel/utils'
import { format } from 'date-fns'
import {
  AlertCircle,
  ArrowDownLeft,
  Banknote,
  Building2,
  CalendarClock,
  Clock,
  CreditCard,
  Download,
  Eye,
  Loader2,
  Smartphone,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { env } from '@/config/env'
import { api } from '@/lib/api'

interface Invoice {
  id: string
  invoiceNumber: string
  type: string
  status: string
  /** Invoice total (Phase 2+ `total` column). */
  total: number
  /** Outstanding balance (authoritative `balance` column). */
  balance: number
  dueDate: string | null
}

interface PaymentRow {
  id: string
  paymentNumber: string | null
  method: string
  amount: number
  status: string
  paymentDate: string | null
  createdAt: string
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  momo: 'Mobile Money',
  transfer: 'Bank Transfer',
  bank_transfer: 'Bank Transfer',
  insurance: 'Insurance',
  wallet: 'Wallet',
}

/** A payment option the clinic configured for the app (label + how-to instructions). */
interface AppPaymentMethod {
  id: string
  label: string
  type: string
  instructions: string | null
}

/** A patient's own payment-confirmation request (drives per-invoice Pay-Now state). */
interface PaymentConfirmation {
  id: string
  invoiceId: string
  methodLabel: string | null
  amount: number
  reference: string | null
  status: 'pending' | 'confirmed' | 'rejected'
  rejectionReason: string | null
  createdAt: string
}

function MethodIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'bank') return <Building2 className={className} />
  if (type === 'momo') return <Smartphone className={className} />
  if (type === 'cash') return <Banknote className={className} />
  return <CreditCard className={className} />
}

const PAGE_SIZE = 8

interface WalletData {
  creditBalance: number
}

interface PlanScheduleItem {
  sequence: number
  expectedDate: string
  expectedAmount: number
  status: string
  amountReceived: number
}

interface PaymentPlan {
  id: string
  planNumber: string | null
  status: string
  scheduleType: string | null
  totalAmount: number
  amountPerInstallment: number | null
  numberOfInstallments: number | null
  paymentFrequency: string | null
  installmentPeriod: string | null
  startDate: string
  endDate: string | null
  schedule: PlanScheduleItem[]
}

const STATUS_COLOR: Record<string, string> = {
  paid: 'text-emerald-600',
  partial: 'text-blue-600',
  pending: 'text-orange-500',
  overdue: 'text-red-500',
  waived: 'text-muted-foreground',
}

export default function PatientPaymentsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [plans, setPlans] = useState<PaymentPlan[]>([])
  const [methods, setMethods] = useState<AppPaymentMethod[]>([])
  const [confirmations, setConfirmations] = useState<PaymentConfirmation[]>([])
  const [payHistory, setPayHistory] = useState<PaymentRow[]>([])
  const [payOffset, setPayOffset] = useState(0)
  const [payHasMore, setPayHasMore] = useState(false)
  const [payLoadingMore, setPayLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'invoices' | 'wallet' | 'plans'>('invoices')
  const [payTarget, setPayTarget] = useState<Invoice | null>(null)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [statementLoading, setStatementLoading] = useState(false)
  // Client-side "show more" counts for the short lists.
  const [invVisible, setInvVisible] = useState(PAGE_SIZE)
  const [planVisible, setPlanVisible] = useState(PAGE_SIZE)

  // Server-paginated payment history (the `payments` table).
  const loadPayments = useCallback(async (offset: number) => {
    const res = await api.get<PaymentRow[]>(
      `/api/patient-portal/payment-history?limit=20&offset=${offset}`
    )
    if (res.success && Array.isArray(res.data)) {
      const rows = res.data.map((p) => ({ ...p, amount: Number(p.amount ?? 0) }))
      setPayHistory((prev) => (offset === 0 ? rows : [...prev, ...rows]))
      setPayOffset(offset + rows.length)
      setPayHasMore(res.hasMore === true)
    }
  }, [])

  // The patient's own confirmation requests — drives per-invoice Pay-Now state.
  const loadConfirmations = useCallback(async () => {
    const res = await api.get<PaymentConfirmation[]>('/api/patient-portal/payment-confirmations')
    if (res.success && Array.isArray(res.data)) {
      setConfirmations(res.data.map((r) => ({ ...r, amount: Number(r.amount ?? 0) })))
    }
  }, [])

  useEffect(() => {
    api
      .get<{ invoices: Invoice[]; wallet: WalletData | null }>('/api/patient-portal/payments')
      .then((res) => {
        if (res.success && res.data) {
          // Money fields arrive as strings (Postgres numeric) — coerce to numbers.
          setInvoices(
            (res.data.invoices ?? []).map((i) => ({
              ...i,
              total: Number(i.total ?? 0),
              balance: Number(i.balance ?? 0),
            }))
          )
          setWallet(
            res.data.wallet
              ? { ...res.data.wallet, creditBalance: Number(res.data.wallet.creditBalance ?? 0) }
              : null
          )
        }
      })
      .finally(() => setLoading(false))

    api
      .get<PaymentPlan[]>('/api/patient-portal/payment-plans')
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setPlans(
            res.data.map((p) => ({
              ...p,
              totalAmount: Number(p.totalAmount ?? 0),
              amountPerInstallment:
                p.amountPerInstallment == null ? null : Number(p.amountPerInstallment),
              schedule: (p.schedule ?? []).map((s) => ({
                ...s,
                expectedAmount: Number(s.expectedAmount ?? 0),
                amountReceived: Number(s.amountReceived ?? 0),
              })),
            }))
          )
        }
      })
      .catch(() => {})

    api
      .get<AppPaymentMethod[]>('/api/patient-portal/payment-methods')
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setMethods(res.data)
      })
      .catch(() => {})

    loadPayments(0).catch(() => {})
    loadConfirmations().catch(() => {})
  }, [loadPayments, loadConfirmations])

  async function downloadStatement() {
    setStatementLoading(true)
    try {
      const res = await fetch(`${env.VITE_API_URL}/api/patient-portal/statement`, {
        credentials: 'include',
        headers: { 'X-App-Id': 'patient' },
      })
      if (!res.ok) {
        toast.error('Could not generate your statement. Please try again.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'denel-statement.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not generate your statement. Please try again.')
    } finally {
      setStatementLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const openInvoices = invoices.filter((i) => Number(i.balance) > 0)
  const totalOutstanding = openInvoices.reduce((s, i) => s + Number(i.balance), 0)

  // Most-recent confirmation per invoice (list is newest-first from the API).
  const confByInvoice = new Map<string, PaymentConfirmation>()
  for (const c of confirmations) {
    if (!confByInvoice.has(c.invoiceId)) confByInvoice.set(c.invoiceId, c)
  }

  return (
    <div className="p-5 pb-8 space-y-5">
      <div className="flex items-start justify-between gap-3 pt-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Your invoices and wallet</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={downloadStatement}
          disabled={statementLoading}
        >
          {statementLoading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          Statement
        </Button>
      </div>

      {/* Wallet summary */}
      <div className="rounded-2xl bg-card border border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-600 dark:bg-teal-900/30">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Wallet Balance</p>
            <p className="text-xl font-bold text-teal-600">
              {formatCurrencyCompact(wallet?.creditBalance ?? 0)}
            </p>
          </div>
        </div>
        {totalOutstanding > 0 && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-base font-bold text-red-500">
              {formatCurrencyCompact(totalOutstanding)}
            </p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 rounded-xl bg-muted/50 p-1">
        <button
          onClick={() => setTab('invoices')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === 'invoices' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
          }`}
        >
          Invoices {openInvoices.length > 0 && `(${openInvoices.length})`}
        </button>
        <button
          onClick={() => setTab('plans')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === 'plans' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
          }`}
        >
          Plans {plans.length > 0 && `(${plans.length})`}
        </button>
        <button
          onClick={() => setTab('wallet')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === 'wallet' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
          }`}
        >
          Transactions
        </button>
      </div>

      {tab === 'invoices' && (
        <div className="space-y-3">
          {openInvoices.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-muted-foreground">No outstanding invoices</p>
              <p className="text-xs text-muted-foreground/70">You're all paid up.</p>
            </div>
          ) : (
            <>
              {openInvoices.slice(0, invVisible).map((inv) => {
                const balance = inv.balance
                const conf = confByInvoice.get(inv.id)
                const isPending = conf?.status === 'pending'
                const isRejected = conf?.status === 'rejected'
                return (
                  <div key={inv.id} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-mono text-muted-foreground">
                          {inv.invoiceNumber}
                        </p>
                        <p className="text-sm font-semibold mt-0.5 capitalize">
                          {inv.type.replace('_', ' ')}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-semibold capitalize ${STATUS_COLOR[inv.status] ?? 'text-muted-foreground'}`}
                      >
                        {inv.status}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Total</p>
                        <p className="font-medium">{formatCurrency(inv.total)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Paid</p>
                        <p className="font-medium text-emerald-600">
                          {formatCurrency(inv.total - inv.balance)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Balance</p>
                        <p
                          className={`font-medium ${balance > 0 ? 'text-red-500' : 'text-muted-foreground'}`}
                        >
                          {formatCurrency(balance)}
                        </p>
                      </div>
                    </div>

                    {inv.dueDate && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Due: {format(new Date(inv.dueDate), 'MMM d, yyyy')}
                      </p>
                    )}

                    {isRejected && conf?.rejectionReason && (
                      <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs dark:border-red-900/40 dark:bg-red-950/30">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                        <div>
                          <p className="font-medium text-red-700 dark:text-red-300">
                            Confirmation declined
                          </p>
                          <p className="mt-0.5 text-red-600/90 dark:text-red-300/80">
                            {conf.rejectionReason}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 pt-3 border-t border-border">
                      {isPending ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full cursor-default text-amber-600"
                          disabled
                        >
                          <Clock className="mr-1.5 h-3.5 w-3.5" />
                          Confirmation pending
                          {conf ? ` · ${formatCurrencyCompact(conf.amount)}` : ''}
                        </Button>
                      ) : (
                        <Button size="sm" className="w-full" onClick={() => setPayTarget(inv)}>
                          <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                          {isRejected ? 'Submit again' : 'Pay now'}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
              {openInvoices.length > invVisible && (
                <LoadMoreButton onClick={() => setInvVisible((v) => v + PAGE_SIZE)} />
              )}
            </>
          )}
        </div>
      )}

      {tab === 'plans' && (
        <div className="space-y-3">
          {plans.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CalendarClock className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-muted-foreground">No payment plans</p>
              <p className="text-xs text-muted-foreground/70">
                The clinic sets these up for treatments paid in instalments.
              </p>
            </div>
          ) : (
            <>
              <Accordion type="single" collapsible className="space-y-3">
                {plans.slice(0, planVisible).map((plan) => (
                  <PlanAccordionItem key={plan.id} plan={plan} />
                ))}
              </Accordion>
              {plans.length > planVisible && (
                <LoadMoreButton onClick={() => setPlanVisible((v) => v + PAGE_SIZE)} />
              )}
            </>
          )}
        </div>
      )}

      {tab === 'wallet' && (
        <div className="space-y-3">
          {payHistory.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Wallet className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-muted-foreground">No transactions yet</p>
            </div>
          ) : (
            <>
              {payHistory.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setReceiptId(p.id)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-brand/40"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <ArrowDownLeft className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{METHOD_LABEL[p.method] ?? p.method}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {format(new Date(p.paymentDate ?? p.createdAt), 'MMM d, yyyy')}
                      {p.paymentNumber ? ` · ${p.paymentNumber}` : ''}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-emerald-600">
                    +{formatCurrency(p.amount)}
                  </p>
                  <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
              {payHasMore && (
                <LoadMoreButton
                  loading={payLoadingMore}
                  onClick={() => {
                    setPayLoadingMore(true)
                    loadPayments(payOffset).finally(() => setPayLoadingMore(false))
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      <PaySheet
        invoice={payTarget}
        methods={methods}
        onClose={() => setPayTarget(null)}
        onSubmitted={() => {
          loadConfirmations().catch(() => {})
          setPayTarget(null)
        }}
      />
      <ReceiptSheet paymentId={receiptId} onClose={() => setReceiptId(null)} />
    </div>
  )
}

interface ReceiptData {
  paymentNumber: string | null
  method: string
  amount: number
  status: string
  paymentDate: string
  patientName: string
  patientIdDisplay: string | null
  allocations: { invoiceNumber: string | null; amount: number; treatments: string[] }[]
}

function ReceiptSheet({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const [data, setData] = useState<ReceiptData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!paymentId) {
      setData(null)
      return
    }
    setLoading(true)
    api
      .get<ReceiptData>(`/api/patient-portal/payment-history/${paymentId}/receipt`)
      .then((res) => {
        if (res.success && res.data) setData(res.data)
      })
      .finally(() => setLoading(false))
  }, [paymentId])

  return (
    <Sheet open={!!paymentId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>Receipt</SheetTitle>
          <SheetDescription>{data?.paymentNumber ?? 'Payment receipt'}</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : data ? (
          <div className="mt-4 space-y-4">
            <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-4 text-sm">
              <Row label="Amount" value={formatCurrency(data.amount)} bold />
              <Row label="Method" value={METHOD_LABEL[data.method] ?? data.method} />
              <Row label="Date" value={format(new Date(data.paymentDate), 'MMM d, yyyy')} />
              <Row label="Status" value={data.status} capitalize />
              {data.patientIdDisplay && <Row label="Patient" value={data.patientIdDisplay} />}
            </div>

            {data.allocations.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Paid towards
                </p>
                {data.allocations.map((a) => (
                  <div
                    key={`${a.invoiceNumber}-${a.amount}`}
                    className="rounded-xl border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-sm font-medium">
                      <span className="font-mono text-xs">{a.invoiceNumber ?? 'Invoice'}</span>
                      <span>{formatCurrency(a.amount)}</span>
                    </div>
                    {a.treatments.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                        {a.treatments.map((t, j) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: static treatment list
                          <li key={j}>{t}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button className="w-full" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Receipt unavailable.</p>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Row({
  label,
  value,
  bold,
  capitalize,
}: {
  label: string
  value: string
  bold?: boolean
  capitalize?: boolean
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`${bold ? 'text-base font-semibold' : 'font-medium'} ${capitalize ? 'capitalize' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

function LoadMoreButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full rounded-xl border border-border bg-card py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
    >
      {loading ? 'Loading…' : 'Load more'}
    </button>
  )
}

function PlanAccordionItem({ plan }: { plan: PaymentPlan }) {
  const totalPaid = plan.schedule.reduce((s, i) => s + Number(i.amountReceived), 0)
  const installments = plan.schedule.length || plan.numberOfInstallments || 0
  const paidCount = plan.schedule.filter((s) => s.status === 'paid').length
  const pct =
    plan.totalAmount > 0 ? Math.min(100, Math.round((totalPaid / plan.totalAmount) * 100)) : 0
  const cadence = plan.installmentPeriod ?? plan.paymentFrequency ?? null

  return (
    <AccordionItem value={plan.id} className="rounded-2xl border border-border bg-card px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex-1 pr-2 text-left">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {plan.planNumber ?? 'Plan'}
            </span>
            <span className="text-xs font-semibold capitalize text-brand">
              {plan.status.replace('_', ' ')}
            </span>
          </div>
          <p className="mt-0.5 text-sm font-semibold">{formatCurrency(plan.totalAmount)} total</p>
          {(plan.amountPerInstallment || installments > 0) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {plan.amountPerInstallment ? formatCurrency(plan.amountPerInstallment) : ''}
              {cadence ? ` · ${cadence}` : ''}
              {installments > 0 ? ` · ${installments} instalments` : ''}
            </p>
          )}
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{formatCurrency(totalPaid)} paid</span>
              <span>
                {installments > 0 ? `${paidCount}/${installments} · ` : ''}
                {pct}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </AccordionTrigger>
      {plan.schedule.length > 0 && (
        <AccordionContent>
          <div className="space-y-1.5 border-t border-border pt-3">
            {plan.schedule.map((s) => (
              <div key={s.sequence} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  #{s.sequence} · {format(new Date(s.expectedDate), 'MMM d, yyyy')}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{formatCurrency(s.expectedAmount)}</span>
                  <span
                    className={`capitalize ${STATUS_COLOR[s.status] ?? 'text-muted-foreground'}`}
                  >
                    {s.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </AccordionContent>
      )}
    </AccordionItem>
  )
}

function PaySheet({
  invoice,
  methods,
  onClose,
  onSubmitted,
}: {
  invoice: Invoice | null
  methods: AppPaymentMethod[]
  onClose: () => void
  onSubmitted: () => void
}) {
  const [methodId, setMethodId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset the form whenever a new invoice opens the sheet.
  const invoiceId = invoice?.id ?? null
  const invoiceBalance = invoice?.balance ?? 0
  useEffect(() => {
    if (invoiceId) {
      setMethodId(null)
      setAmount(centsToInput(invoiceBalance))
      setReference('')
      setNote('')
    }
  }, [invoiceId, invoiceBalance])

  if (!invoice) {
    return <Sheet open={false} onOpenChange={() => onClose()} />
  }

  const balance = invoice.balance
  const clinicPhone = env.VITE_CLINIC_PHONE?.trim()
  const amountCents = inputToCents(amount)
  const amountValid = amountCents > 0 && amountCents <= balance
  const canSubmit = !submitting && amountValid && (methods.length === 0 || methodId !== null)

  async function submit() {
    if (!invoice || !canSubmit) return
    setSubmitting(true)
    const res = await api.post('/api/patient-portal/payment-confirmations', {
      invoiceId: invoice.id,
      methodId: methodId ?? undefined,
      amount: amountCents,
      reference: reference.trim() || undefined,
      note: note.trim() || undefined,
    })
    setSubmitting(false)
    if (res.success) {
      toast.success("Sent — we'll verify your payment and update your balance.")
      onSubmitted()
    } else {
      toast.error(res.error ?? 'Could not submit your request. Please try again.')
    }
  }

  return (
    <Sheet open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Pay invoice #{invoice.invoiceNumber}</SheetTitle>
          <SheetDescription>
            Pay with one of the options below, then tell us — we'll verify and update your balance.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Amount due</p>
            <p className="text-2xl font-semibold">{formatCurrency(balance)}</p>
            <p className="mt-2 text-xs text-muted-foreground">Reference</p>
            <p className="font-mono text-sm">INV-{invoice.invoiceNumber}</p>
          </div>

          {/* Step 1 — choose how you paid */}
          {methods.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                How did you pay?
              </Label>
              <div className="space-y-2">
                {methods.map((m) => {
                  const active = m.id === methodId
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMethodId(m.id)}
                      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                        active ? 'border-brand bg-brand/5' : 'border-border hover:bg-accent'
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          active ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <MethodIcon type={m.type} className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{m.label}</p>
                        {active && m.instructions && (
                          <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                            {m.instructions}
                          </pre>
                        )}
                      </div>
                      <div
                        className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
                          active ? 'border-brand bg-brand' : 'border-muted-foreground/40'
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Payment options aren't set up yet. Please call the clinic
              {clinicPhone ? ` at ${clinicPhone}` : ''} to arrange your payment.
            </div>
          )}

          {/* Step 2 — confirm what you sent */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount you paid (GHS)</Label>
              <Input
                id="pay-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                max={centsToInput(balance)}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {!amountValid && amount !== '' && (
                <p className="text-xs text-red-500">
                  Enter an amount between {formatCurrency(1)} and {formatCurrency(balance)}.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Paying less is fine — your balance updates by what we confirm.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">Transaction reference (optional)</Label>
              <Input
                id="pay-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. MoMo transaction ID"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-note">Note (optional)</Label>
              <Textarea
                id="pay-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything we should know"
                rows={2}
              />
            </div>
          </div>

          <Button className="w-full" onClick={submit} disabled={!canSubmit}>
            {submitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="mr-1.5 h-4 w-4" />
            )}
            Request confirmation
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            We'll review and confirm — usually within 24 hours.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
