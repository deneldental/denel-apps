import { CalendarClock, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { confirmEstimate } from '@/lib/actions/worklist'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { centsToInput, parseCurrency } from '@/shared/utils/currency'
import { ghs } from './shared'

type PaymentSource = {
  key: string
  method: string
  amount: string
  externalReference: string
}

type InvoiceLine = {
  id: string
  description?: string | null
  serviceName?: string | null
  quantity?: number
  lineTotal?: number | string | null
}

function newSource(method = 'cash'): PaymentSource {
  return {
    key: `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    method,
    amount: '',
    externalReference: '',
  }
}

interface Props {
  appointmentId: string
  patientId: string
  patientName: string
  estimateTotal: number
  estimateInvoiceId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmed: () => void
  onCreatePlan?: () => void
}

export function ConfirmEstimateSheet({
  appointmentId,
  patientId,
  patientName,
  estimateTotal,
  estimateInvoiceId,
  open,
  onOpenChange,
  onConfirmed,
  onCreatePlan,
}: Props) {
  const [takePayment, setTakePayment] = useState(true)
  /** Text the patient a confirmation of the payment taken (G08); there is none without a payment. */
  const [sendSms, setSendSms] = useState(true)
  const [sources, setSources] = useState<PaymentSource[]>([newSource('cash')])
  /** Reception typed an amount: from then on the sheet leaves the amounts alone. */
  const [amountTyped, setAmountTyped] = useState(false)

  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set())

  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const linesQuery = useApiQuery(
    queryKeys.invoices.detail(estimateInvoiceId || 'none'),
    () => api.get<{ lines?: InvoiceLine[] }>(`/api/invoices/${estimateInvoiceId}`),
    { enabled: open && !!estimateInvoiceId }
  )
  const lines = useMemo(
    () => (Array.isArray(linesQuery.data?.lines) ? (linesQuery.data?.lines as InvoiceLine[]) : []),
    [linesQuery.data]
  )
  const loadingLines = open && !!estimateInvoiceId && linesQuery.isLoading

  const walletQuery = useApiQuery(
    queryKeys.patients.balance(patientId || 'none'),
    () => api.get<{ walletBalance: number }>(`/api/patients/${patientId}/ledger`),
    { enabled: open && !!patientId }
  )
  const walletBalance = Number(walletQuery.data?.walletBalance) || 0

  const activeTotal =
    lines.length > 0
      ? lines
          .filter((l) => selectedLineIds.has(l.id))
          .reduce((acc, l) => acc + Number(l.lineTotal), 0)
      : estimateTotal

  // The one method's amount follows the ticked lines' total — unticking a line takes it off the
  // payment too — until reception types an amount or splits the payment. (It used to be set once
  // and never again, which mattered once the unticked lines stopped being invoiced.)
  useEffect(() => {
    if (amountTyped) return
    setSources((prev) => {
      if (prev.length !== 1) return prev
      // The input holds cedis TEXT; `activeTotal` is cents.
      const amount = centsToInput(activeTotal)
      return prev[0].amount === amount ? prev : [{ ...prev[0], amount }]
    })
  }, [activeTotal, amountTyped])

  // Reset/derive the line-selection whenever the loaded lines change (a fresh
  // fetch for this invoice, or the sheet closing/clearing to no invoice).
  useEffect(() => {
    setSelectedLineIds(new Set(lines.map((l) => l.id)))
  }, [lines])

  // Source inputs hold cedis TEXT; `parseCurrency` returns integer CENTS, the
  // unit `activeTotal` and `walletBalance` already use.
  const sourceTotal = useMemo(
    () => sources.reduce((s, src) => s + parseCurrency(src.amount), 0),
    [sources]
  )

  const walletUsed = useMemo(
    () =>
      sources
        .filter((s) => s.method === 'wallet')
        .reduce((s, src) => s + parseCurrency(src.amount), 0),
    [sources]
  )

  const remainder = activeTotal - sourceTotal
  const walletOverdrawn = walletUsed > walletBalance

  const canSubmit =
    selectedLineIds.size > 0 &&
    (!takePayment || sources.some((s) => parseCurrency(s.amount) > 0)) &&
    !walletOverdrawn

  function addSource() {
    setSources((prev) => [...prev, newSource()])
  }

  function removeSource(key: string) {
    setSources((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.key !== key)))
  }

  function updateSource(key: string, patch: Partial<PaymentSource>) {
    setSources((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  const toggleLine = (id: string, checked: boolean) => {
    const next = new Set(selectedLineIds)
    if (checked) next.add(id)
    else next.delete(id)
    setSelectedLineIds(next)
  }

  async function handleConfirm() {
    setStatusMessage(undefined)

    const acceptedLineItemIds = lines.length > 0 ? Array.from(selectedLineIds) : undefined
    if (acceptedLineItemIds && acceptedLineItemIds.length === 0) {
      toast.error('At least one item must be selected')
      return
    }

    const payments = takePayment
      ? sources
          .filter((s) => parseCurrency(s.amount) > 0)
          .map((s) => ({
            method: s.method,
            // The API speaks CENTS.
            amount: parseCurrency(s.amount),
            externalReference: s.externalReference.trim() || null,
          }))
      : undefined

    if (takePayment && (!payments || payments.length === 0)) {
      toast.error('Enter at least one payment amount')
      return
    }

    await submit(async () => {
      const res = await confirmEstimate(appointmentId, payments, {
        sendSms: takePayment && sendSms,
        // Only the ticked lines are issued; the server moves the rest to a new draft estimate.
        acceptedLineItemIds,
      })

      if (!res.success) {
        setStatusMessage(res.error || 'Failed to confirm')
        toast.error(res.error || 'Failed to confirm')
        return
      }

      toast.success(
        takePayment ? 'Confirmed — payment recorded.' : 'Estimate issued — collect later.'
      )
      if (res.smsError) {
        toast.warning(`Payment recorded, but the confirmation text was not sent: ${res.smsError}`)
      }

      if (takePayment) {
        try {
          const { generatePaymentReceipt } = await import('@/shared/utils/receipt')
          const data = payments?.[0]
          const paymentDescription = lines.map((l) => l.description || l.serviceName).join(', ')

          if (data) {
            generatePaymentReceipt({
              paymentId: res.data?.paymentId || undefined,
              patientName,
              amountPaid: data.amount,
              paymentMethod: data.method,
              description: paymentDescription,
              paymentType: 'one-time',
              appointmentDate: new Date(),
            })
          }
        } catch (error) {
          console.error('Failed to generate receipt:', error)
        }
      }

      onOpenChange(false)
      onConfirmed()
    })
  }

  return (
    <SheetFormLayout
      open={open}
      onOpenChange={onOpenChange}
      title={`Confirm estimate — ${patientName}`}
      description={`Issuing posts the ${ghs(activeTotal)} to the patient's account. Unchecked items split into a new draft estimate.`}
      size="md"
      submitting={isSubmitting}
      submitDisabled={!canSubmit || isSubmitting}
      submitLabel={takePayment ? 'Confirm & accept payment' : 'Confirm (issue)'}
      onSubmit={handleConfirm}
      statusMessage={statusMessage}
    >
      <div className="space-y-4">
        {loadingLines ? (
          <div className="flex justify-center p-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : lines.length > 0 ? (
          <div className="space-y-2 rounded-md border p-3">
            <h4 className="text-sm font-semibold text-muted-foreground mb-2">Estimate Items</h4>
            {lines.map((l) => (
              <label key={l.id} className="flex items-start gap-3 cursor-pointer py-1">
                <Checkbox
                  checked={selectedLineIds.has(l.id)}
                  onCheckedChange={(c) => toggleLine(l.id, c === true)}
                  className="mt-1"
                />
                <div className="flex-1 text-sm">
                  <p className="font-medium">{l.description || l.serviceName}</p>
                  <p className="text-xs text-muted-foreground">Qty: {l.quantity}</p>
                </div>
                <div className="text-sm font-medium">{ghs(Number(l.lineTotal))}</div>
              </label>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
          <span className="text-sm text-muted-foreground">Invoice total</span>
          <span className="text-lg font-semibold">{ghs(activeTotal)}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5">
            <Checkbox checked={takePayment} onCheckedChange={(v) => setTakePayment(v === true)} />
            <div>
              <p className="text-sm font-medium">Take payment now</p>
              {/* Spell out the consequence: unchecked, this reads as a neutral
                  convenience, but it leaves the visit unfunded and treatment
                  gated. A deposit or a payment plan both clear it. */}
              <p className="text-xs text-muted-foreground">
                {takePayment
                  ? 'Uncheck to issue and collect later.'
                  : 'Issue now, collect later — treatment stays blocked until a payment or a payment plan is recorded.'}
              </p>
            </div>
          </label>

          {onCreatePlan && (
            <button
              type="button"
              onClick={onCreatePlan}
              className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
            >
              <CalendarClock className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Create a plan</p>
                <p className="text-xs text-muted-foreground">Set up installment payments.</p>
              </div>
            </button>
          )}
        </div>

        {takePayment && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Payment methods</Label>
              <Button type="button" variant="outline" size="sm" onClick={addSource}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add method
              </Button>
            </div>

            {sources.map((src, idx) => (
              <div key={src.key} className="grid grid-cols-12 gap-3 rounded-md border p-3">
                <div className="col-span-12 sm:col-span-4 space-y-1.5">
                  <Label className="text-xs">Method</Label>
                  <PaymentMethodSelect
                    value={src.method}
                    onValueChange={(v) => updateSource(src.key, { method: v })}
                    placeholder="Select method"
                  />
                </div>
                <div className="col-span-6 sm:col-span-3 space-y-1.5">
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={src.amount}
                    onChange={(e) => {
                      setAmountTyped(true)
                      updateSource(src.key, { amount: e.target.value })
                    }}
                  />
                </div>
                <div className="col-span-6 sm:col-span-4 space-y-1.5">
                  <Label className="text-xs">Reference</Label>
                  <Input
                    placeholder="e.g. txn id"
                    value={src.externalReference}
                    onChange={(e) => updateSource(src.key, { externalReference: e.target.value })}
                  />
                </div>
                <div className="col-span-12 sm:col-span-1 flex items-end justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    disabled={sources.length <= 1}
                    onClick={() => removeSource(src.key)}
                    aria-label="Remove payment method"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {idx === 0 && src.method === 'wallet' && (
                  <p className="col-span-12 text-xs text-muted-foreground">
                    Wallet credit available: {ghs(walletBalance)}
                  </p>
                )}
              </div>
            ))}

            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
              <span className="text-sm text-muted-foreground">Total payment</span>
              <span className="text-lg font-semibold">{ghs(sourceTotal)}</span>
            </div>

            {remainder !== 0 && (
              <p className={`text-sm ${remainder > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                {remainder > 0
                  ? `Remaining balance: ${ghs(remainder)}`
                  : `Overpayment (will become wallet credit): ${ghs(Math.abs(remainder))}`}
              </p>
            )}

            {walletOverdrawn && (
              <p className="text-sm text-destructive">
                Wallet credit available is {ghs(walletBalance)}; you've entered {ghs(walletUsed)}.
              </p>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="confirm-send-sms"
                checked={sendSms}
                onCheckedChange={(v) => setSendSms(v === true)}
              />
              <Label htmlFor="confirm-send-sms" className="cursor-pointer text-sm font-normal">
                Text the patient a payment confirmation (SMS)
              </Label>
            </div>
          </div>
        )}
      </div>
    </SheetFormLayout>
  )
}
