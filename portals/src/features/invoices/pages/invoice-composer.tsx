import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ViewAuditHistoryLink } from '@/features/audit-logs/components/view-audit-history-link'
import { IssueCreditNoteDialog } from '@/features/credit-notes/components/issue-credit-note-dialog'
import { ReceivePaymentDialog } from '@/features/payments/components/receive-payment-dialog'
import { type Account, listAccounts } from '@/lib/actions/accounting'
import { type CreditNote, listCreditNotes } from '@/lib/actions/credit-notes'
import {
  addInvoiceLine,
  applyInvoiceCredit,
  getInvoice,
  type InvoiceDraft,
  type InvoiceLine,
  issueInvoice,
  listInvoiceLines,
  removeInvoiceLine,
  voidInvoice,
} from '@/lib/actions/invoices-v2'
import { getPatientCredit } from '@/lib/actions/payments-v2'
import { listSpecialists, type Specialist } from '@/lib/actions/specialists'
import { usePermissions } from '@/lib/permissions-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
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
import { VoidDocumentDialog } from '@/shared/components/void-document-dialog'
import { formatCurrency, parseCurrency } from '@/shared/utils/currency'
import { additionalUnitPriceOf } from '@/shared/utils/invoice-line-display'

type LineForm = {
  description: string
  quantity: string
  unitPrice: string
  discountType: 'none' | 'percent' | 'amount'
  discountValue: string
  taxRate: string
  revenueAccountId: string
  specialistId: string | 'none'
  deferRevenue: boolean
}

const EMPTY_LINE: LineForm = {
  description: '',
  quantity: '1',
  unitPrice: '',
  discountType: 'none',
  discountValue: '0',
  taxRate: '0',
  revenueAccountId: '',
  specialistId: 'none',
  deferRevenue: false,
}

export default function InvoiceComposerPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isAdmin = usePermissions()?.isAdmin ?? false
  const queryClient = useQueryClient()

  const [lineForm, setLineForm] = useState<LineForm>(EMPTY_LINE)
  const [adding, setAdding] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [applyingCredit, setApplyingCredit] = useState(false)
  const [creditNoteOpen, setCreditNoteOpen] = useState(false)

  const INVOICE_KEY = queryKeys.invoices.detail(id)
  const LINES_KEY = queryKeys.invoices.lines(id)

  const invoiceQuery = useApiQuery<InvoiceDraft>(INVOICE_KEY, () => getInvoice(id))
  const invoice = invoiceQuery.data ?? null
  const patientId = invoice?.patientId

  const linesQuery = useApiQuery<InvoiceLine[]>(LINES_KEY, () => listInvoiceLines(id))
  const lines = linesQuery.data ?? []

  const accountsQuery = useApiQuery<Account[]>(
    queryKeys.accounting.accounts({ type: 'revenue' }),
    () => listAccounts({ type: 'revenue' })
  )
  const revenueAccounts = useMemo(
    () => (accountsQuery.data ?? []).filter((a) => a.type === 'revenue' && a.subtype !== 'Contra'),
    [accountsQuery.data]
  )
  // Seed the line form's default account once the list loads, without
  // clobbering a value the user already picked.
  useMemo(() => {
    if (revenueAccounts.length === 0) return
    setLineForm((f) => (f.revenueAccountId ? f : { ...f, revenueAccountId: revenueAccounts[0].id }))
    // Only re-run when the list identity changes (structural sharing keeps it
    // stable across no-op refetches) — not on every lineForm edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenueAccounts])

  const specialistsQuery = useApiQuery<Specialist[]>(queryKeys.specialists.list(), () =>
    listSpecialists()
  )
  const specialists = useMemo(
    () => (specialistsQuery.data ?? []).filter((s) => s.isActive),
    [specialistsQuery.data]
  )

  // Credit notes need `credit_notes:read`, which billing roles don't carry,
  // and everything rendered from them below is admin-only anyway — so skip
  // the call rather than log a guaranteed 403 on every composer open.
  const creditNotesQuery = useApiQuery<CreditNote[]>(
    queryKeys.creditNotes.list({ invoiceId: id }),
    () => listCreditNotes({ invoiceId: id }),
    { enabled: isAdmin }
  )
  const creditNotes = creditNotesQuery.data ?? []

  const creditQuery = useApiQuery<{ depositBalance: number }>(
    queryKeys.patients.credit(patientId ?? ''),
    () => getPatientCredit(patientId as string),
    { enabled: !!patientId }
  )
  const availableCredit = Number(creditQuery.data?.depositBalance ?? 0)

  const loading =
    invoiceQuery.isLoading ||
    linesQuery.isLoading ||
    accountsQuery.isLoading ||
    specialistsQuery.isLoading

  /**
   * Re-fetch the invoice header + the patient's available credit. Used after
   * issue / apply-credit / void / receive-payment — mutations that change the
   * header but not the line set. Lines are kept up to date by targeted cache
   * patches from `addInvoiceLine`/`removeInvoiceLine`, and credit notes are
   * only refetched after a credit-note action (remediation H23).
   */
  async function refreshInvoice(): Promise<void> {
    await invoiceQuery.refetch()
    if (patientId) await creditQuery.refetch()
  }

  async function refreshCreditNotes() {
    if (!isAdmin) return
    await creditNotesQuery.refetch()
  }

  const totals = useMemo(() => {
    let subtotal = 0
    let discount = 0
    let tax = 0
    let total = 0
    for (const l of lines) {
      subtotal += Number(l.lineSubtotal)
      discount += Number(l.discountAmount)
      tax += Number(l.taxAmount)
      total += Number(l.lineTotal)
    }
    return { subtotal, discount, tax, total }
  }, [lines])

  async function onAddLine() {
    if (!lineForm.description.trim()) return toast.error('Description is required')
    if (!lineForm.unitPrice) return toast.error('Unit price is required')
    if (!lineForm.revenueAccountId) return toast.error('Pick a revenue account')

    setAdding(true)
    const res = await addInvoiceLine(id, {
      description: lineForm.description.trim(),
      quantity: Number(lineForm.quantity) || 1,
      // The API speaks CENTS. `discountValue` is dual-semantic: a whole-number
      // PERCENTAGE when discountType is 'percent', otherwise a money amount —
      // only the money form gets scaled (matching migration 0209's handling of
      // the invoice_lines.discount_value column).
      unitPrice: parseCurrency(lineForm.unitPrice),
      discountType: lineForm.discountType,
      discountValue:
        lineForm.discountType === 'amount'
          ? parseCurrency(lineForm.discountValue)
          : Number(lineForm.discountValue) || 0,
      taxRate: Number(lineForm.taxRate) || 0,
      revenueAccountId: lineForm.revenueAccountId,
      specialistId: lineForm.specialistId === 'none' ? null : lineForm.specialistId,
      deferRevenue: lineForm.deferRevenue,
    })
    setAdding(false)
    if (!res.success || !res.data) {
      toast.error(res.error ?? 'Failed to add line')
      return
    }
    // Targeted cache patch: append the server-computed line instead of
    // refetching the whole invoice + every line + credit notes (H23).
    const created = res.data
    queryClient.setQueryData<InvoiceLine[]>(LINES_KEY, (prev) => [...(prev ?? []), created])
    setLineForm({ ...EMPTY_LINE, revenueAccountId: lineForm.revenueAccountId })
  }

  async function onRemoveLine(lineId: string) {
    const res = await removeInvoiceLine(id, lineId)
    if (!res.success) return toast.error(res.error ?? 'Failed to remove line')
    // Targeted cache patch: drop the removed line (H23).
    queryClient.setQueryData<InvoiceLine[]>(LINES_KEY, (prev) =>
      (prev ?? []).filter((l) => l.id !== lineId)
    )
  }

  async function onIssue() {
    if (lines.length === 0) return toast.error('Add at least one line first')
    setIssuing(true)
    const res = await issueInvoice(id)
    setIssuing(false)
    if (!res.success) return toast.error(res.error ?? 'Failed to issue')
    toast.success(`Issued — JE ${res.data?.journalEntry.entryNumber}`)
    // Issuing recomputes line tax/totals server-side — refresh header + lines,
    // but not credit notes (none can exist on a just-issued invoice).
    await Promise.all([refreshInvoice(), linesQuery.refetch()])
  }

  async function onApplyCredit() {
    setApplyingCredit(true)
    const res = await applyInvoiceCredit(id)
    setApplyingCredit(false)
    if (!res.success) return toast.error(res.error ?? 'Failed to apply credit')
    toast.success(
      `Applied ${res.data?.totalApplied ?? 0} across ${res.data?.applied.length ?? 0} payment(s)`
    )
    // Only the header (balance, status) and available credit change.
    await refreshInvoice()
  }

  async function onVoid(reason: string) {
    const res = await voidInvoice(id, reason)
    if (!res.success) {
      toast.error(res.error ?? 'Failed to void')
      return false
    }
    toast.success('Invoice voided')
    await refreshInvoice()
    return true
  }

  // After a credit-note action the invoice balance/status changes AND a new
  // credit note exists — this is the only path that refetches credit notes.
  async function onCreditNotePosted() {
    await Promise.all([refreshInvoice(), refreshCreditNotes()])
  }

  if (loading) return <Skeleton className="h-64 m-6" />
  if (!invoice) return <div className="p-6 text-red-600">Invoice not found</div>

  const isDraft = invoice.status === 'draft'
  const isIssued = invoice.status === 'issued' || invoice.status === 'partially_paid'

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Invoice {invoice.invoiceNumber}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <Badge variant={isDraft ? 'outline' : 'default'} className="mr-2">
              {invoice.status}
            </Badge>
            {invoice.currency} · {invoice.issueDate ?? 'no issue date'}
            {invoice.journalEntryId ? ` · posted` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Back
          </Button>
          {/* §19.2 — admin-only audit drill-down for this invoice */}
          {isAdmin && <ViewAuditHistoryLink entityId={invoice.id} variant="ghost" />}
          {isDraft && (
            <Button onClick={onIssue} disabled={issuing || lines.length === 0}>
              {issuing ? 'Issuing…' : 'Issue invoice'}
            </Button>
          )}
          {isIssued && (
            <>
              <Button variant="outline" onClick={() => setReceiveOpen(true)}>
                Receive payment
              </Button>
              {availableCredit > 0 && (
                <Button
                  variant="outline"
                  onClick={onApplyCredit}
                  disabled={applyingCredit}
                  title={`Available credit: ${formatCurrency(availableCredit)}`}
                >
                  {applyingCredit
                    ? 'Applying…'
                    : `Apply credit (${formatCurrency(availableCredit)})`}
                </Button>
              )}
              {/* Credit note + void reduce/cancel the bill — admin-only. */}
              {isAdmin && (
                <>
                  <Button variant="outline" onClick={() => setCreditNoteOpen(true)}>
                    Credit note
                  </Button>
                  <Button variant="destructive" onClick={() => setVoidOpen(true)}>
                    Void
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Revenue acct</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Disc</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.lineNumber}</TableCell>
                  <TableCell>
                    {l.description}
                    {l.deferRevenue && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        Deferred
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {l.revenueAccount?.code ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">{l.quantity}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(l.unitPrice)}
                    {/* A first-unit / additional-unit line (G01) stores the first unit's price. */}
                    {additionalUnitPriceOf(l) != null && (
                      <div className="text-[10px] text-muted-foreground">
                        then {formatCurrency(additionalUnitPriceOf(l) ?? 0)} each
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {l.discountAmount > 0 ? formatCurrency(l.discountAmount) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {l.taxAmount > 0 ? formatCurrency(l.taxAmount) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(l.lineTotal)}
                  </TableCell>
                  <TableCell>
                    {isDraft && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemoveLine(l.id)}
                        title="Remove line"
                        aria-label="Delete"
                      >
                        <Trash2 className="size-4 text-red-600" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {lines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-sm text-muted-foreground text-center py-6">
                    No lines yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {isDraft && (
            <div className="rounded border p-3 space-y-3">
              <p className="text-sm font-medium">Add a line</p>
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">
                  <Label htmlFor="ln-desc">Description</Label>
                  <Input
                    id="ln-desc"
                    value={lineForm.description}
                    onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })}
                  />
                </div>
                <div className="col-span-3">
                  <Label htmlFor="ln-rev">Revenue account</Label>
                  <Select
                    value={lineForm.revenueAccountId}
                    onValueChange={(v) => setLineForm({ ...lineForm, revenueAccountId: v })}
                  >
                    <SelectTrigger id="ln-rev">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {revenueAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1">
                  <Label htmlFor="ln-qty">Qty</Label>
                  <Input
                    id="ln-qty"
                    type="number"
                    step="0.01"
                    value={lineForm.quantity}
                    onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="ln-unit">Unit price</Label>
                  <Input
                    id="ln-unit"
                    type="number"
                    step="0.01"
                    value={lineForm.unitPrice}
                    onChange={(e) => setLineForm({ ...lineForm, unitPrice: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="ln-tax">Tax %</Label>
                  <Input
                    id="ln-tax"
                    type="number"
                    step="0.01"
                    value={lineForm.taxRate}
                    onChange={(e) => setLineForm({ ...lineForm, taxRate: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-3">
                  <Label htmlFor="ln-disct">Discount type</Label>
                  <Select
                    value={lineForm.discountType}
                    onValueChange={(v) =>
                      setLineForm({ ...lineForm, discountType: v as LineForm['discountType'] })
                    }
                  >
                    <SelectTrigger id="ln-disct">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="percent">Percent</SelectItem>
                      <SelectItem value="amount">Amount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label htmlFor="ln-discv">Discount value</Label>
                  <Input
                    id="ln-discv"
                    type="number"
                    step="0.01"
                    value={lineForm.discountValue}
                    onChange={(e) => setLineForm({ ...lineForm, discountValue: e.target.value })}
                    disabled={lineForm.discountType === 'none'}
                  />
                </div>
                <div className="col-span-4">
                  <Label htmlFor="ln-spec">Specialist (optional)</Label>
                  <Select
                    value={lineForm.specialistId}
                    onValueChange={(v) => setLineForm({ ...lineForm, specialistId: v })}
                  >
                    <SelectTrigger id="ln-spec">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {specialists.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({s.defaultCommissionRate}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3 flex items-end">
                  <Button onClick={onAddLine} disabled={adding} className="w-full">
                    {adding ? 'Adding…' : 'Add line'}
                  </Button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={lineForm.deferRevenue}
                  onCheckedChange={(c) => setLineForm({ ...lineForm, deferRevenue: Boolean(c) })}
                />
                Defer revenue (post to 2400 Deferred Revenue, recognise later via milestones)
              </label>
            </div>
          )}

          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-mono">{formatCurrency(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Discount</span>
                <span className="font-mono">{formatCurrency(totals.discount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span className="font-mono">{formatCurrency(totals.tax)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span className="font-mono">{formatCurrency(totals.total)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {isAdmin && creditNotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credit notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditNotes.map((cn) => (
                  <TableRow key={cn.id}>
                    <TableCell className="font-mono text-sm">{cn.creditNoteNumber}</TableCell>
                    <TableCell className="text-sm">{cn.issueDate}</TableCell>
                    <TableCell className="text-sm">{cn.reason}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(cn.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={cn.status === 'posted' ? 'default' : 'outline'}>
                        {cn.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {invoice.patientId && (
        <ReceivePaymentDialog
          open={receiveOpen}
          onOpenChange={setReceiveOpen}
          patientId={invoice.patientId}
          onPosted={refreshInvoice}
        />
      )}

      <IssueCreditNoteDialog
        open={creditNoteOpen}
        onOpenChange={setCreditNoteOpen}
        invoiceId={id}
        invoiceNumber={invoice.invoiceNumber}
        invoiceBalance={Number(invoice.balance)}
        invoiceTaxTotal={Number(invoice.taxTotal)}
        invoiceTotal={Number(invoice.total)}
        onPosted={onCreditNotePosted}
      />

      <VoidDocumentDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        documentLabel="invoice"
        description="This posts a reversal entry. Allowed only when no payments are allocated. Use a credit note for invoices with payments."
        onConfirm={onVoid}
      />
    </div>
  )
}
