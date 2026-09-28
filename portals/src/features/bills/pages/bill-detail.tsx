import { Money } from '@denel/utils'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { type Account, listAccounts } from '@/lib/actions/accounting'
import {
  type Bill,
  type CreateBillInput,
  createDraftBill,
  getBill,
  type PayBillInput,
  payBill,
  postBillById,
  voidBill,
} from '@/lib/actions/bills'
import { listSuppliers, type Supplier } from '@/lib/actions/suppliers'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
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
import { Textarea } from '@/shared/components/ui/textarea'
import { VoidDocumentDialog } from '@/shared/components/void-document-dialog'
import { formatCurrency } from '@/shared/utils/currency'

type LineDraft = {
  description: string
  quantity: string
  unitPrice: string
  taxRate: string
  expenseAccountId: string
}

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = !id || id === 'new'
  const queryClient = useQueryClient()

  const billQuery = useApiQuery<Bill>(
    queryKeys.bills.detail(id ?? ''),
    () => getBill(id as string),
    { enabled: !isNew }
  )
  const bill = billQuery.data ?? null

  const suppliersQuery = useApiQuery<Supplier[]>(queryKeys.suppliers.list(), () => listSuppliers())
  const suppliers = useMemo(
    () => (suppliersQuery.data ?? []).filter((s) => s.active),
    [suppliersQuery.data]
  )

  const expenseAccountsQuery = useApiQuery<Account[]>(
    queryKeys.accounting.accounts({ type: 'expense' }),
    () => listAccounts({ type: 'expense' })
  )
  const expenseAccounts = useMemo(
    () => (expenseAccountsQuery.data ?? []).filter((a) => a.type === 'expense'),
    [expenseAccountsQuery.data]
  )

  const loading = billQuery.isLoading || suppliersQuery.isLoading || expenseAccountsQuery.isLoading

  // New-bill state
  const [supplierId, setSupplierId] = useState('')
  const [supplierBillRef, setSupplierBillRef] = useState('')
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([
    { description: '', quantity: '1', unitPrice: '', taxRate: '0', expenseAccountId: '' },
  ])
  const [creating, setCreating] = useState(false)

  // Existing-bill actions
  const [posting, setPosting] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [paying, setPaying] = useState(false)
  // Free-form so the configurable lookup's slug submits verbatim; re-narrowed to
  // `PayBillInput['method']` only at the `payBill` call boundary.
  const [payMethod, setPayMethod] = useState<string>('bank_transfer')

  // Race/unmount safety that the old manual fetch needed an epoch counter for
  // is now handled by TanStack Query itself (stale responses are ignored).
  async function refresh() {
    if (isNew) return
    await billQuery.refetch()
  }

  useEffect(() => {
    if (isNew && expenseAccounts[0]?.id) {
      setLines((prev) =>
        prev.map((l) =>
          l.expenseAccountId ? l : { ...l, expenseAccountId: expenseAccounts[0].id }
        )
      )
    }
  }, [expenseAccounts, isNew])

  // Client-side preview only — the figures the bill posts with are whatever the
  // server computes on save, and the UI labels this "estimated" so it is never
  // mistaken for the authoritative total (remediation H21). Cents throughout,
  // and both legs go through `Money`, so it now rounds each line exactly the
  // way `computeBillLine` does server-side rather than drifting by a cent.
  const newTotals = useMemo(() => {
    let subtotal = Money.zero()
    let tax = Money.zero()
    for (const l of lines) {
      const q = Number(l.quantity) || 0
      const rate = Number(l.taxRate) || 0
      const unitCents = Math.round((Number(l.unitPrice) || 0) * 100)
      const sub = Money.fromCents(unitCents).mul(q)
      subtotal = subtotal.add(sub)
      tax = tax.add(sub.percent(rate))
    }
    return {
      subtotal: subtotal.toDbValue(),
      tax: tax.toDbValue(),
      total: subtotal.add(tax).toDbValue(),
    }
  }, [lines])

  function addLine() {
    setLines([
      ...lines,
      {
        description: '',
        quantity: '1',
        unitPrice: '',
        taxRate: '0',
        expenseAccountId: expenseAccounts[0]?.id ?? '',
      },
    ])
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  function removeLine(idx: number) {
    if (lines.length === 1) return
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }

  async function onCreate() {
    if (!supplierId) return toast.error('Pick a supplier')
    const validLines = lines.filter(
      (l) => l.description.trim() && Number(l.unitPrice) > 0 && l.expenseAccountId
    )
    if (validLines.length === 0) return toast.error('Add at least one valid line')

    setCreating(true)
    const input: CreateBillInput = {
      supplierId,
      supplierBillRef: supplierBillRef.trim() || null,
      issueDate,
      dueDate: dueDate || undefined,
      notes: notes.trim() || null,
      lines: validLines.map((l) => ({
        description: l.description.trim(),
        quantity: Number(l.quantity) || 1,
        // The API speaks CENTS — the input holds cedis, so scale on the way out.
        unitPrice: Math.round(Number(l.unitPrice) * 100),
        taxRate: Number(l.taxRate) || 0,
        expenseAccountId: l.expenseAccountId,
      })),
    }
    const res = await createDraftBill(input)
    setCreating(false)
    if (!res.success || !res.data) return toast.error(res.error ?? 'Failed to create bill')
    toast.success(`Drafted ${res.data.billNumber}`)
    queryClient.invalidateQueries({ queryKey: queryKeys.bills.all })
    navigate(`/bills/${res.data.id}`)
  }

  async function onPost() {
    if (!bill) return
    setPosting(true)
    const res = await postBillById(bill.id)
    setPosting(false)
    if (!res.success) return toast.error(res.error ?? 'Failed to post')
    toast.success(`Posted — JE ${res.data?.journalEntry.entryNumber ?? ''}`)
    queryClient.invalidateQueries({ queryKey: queryKeys.bills.all })
    refresh()
  }

  // Confirm callback for the shared VoidDocumentDialog — the dialog owns the
  // busy state, disables its buttons and blocks close while this runs (H22).
  async function onVoid(reason: string) {
    if (!bill) return false
    const res = await voidBill(bill.id, reason)
    if (!res.success) {
      toast.error(res.error ?? 'Failed to void')
      return false
    }
    toast.success('Bill voided')
    queryClient.invalidateQueries({ queryKey: queryKeys.bills.all })
    await refresh()
    return true
  }

  async function onPay() {
    if (!bill || paying) return
    // The input holds cedis; the API and `bill.balance` are both in CENTS.
    const amtCents = Math.round((Number(payAmount) || 0) * 100)
    if (amtCents <= 0) return toast.error('Enter an amount')
    if (amtCents > bill.balance) return toast.error('Exceeds bill balance')
    setPaying(true)
    const res = await payBill(bill.id, {
      amount: amtCents,
      method: payMethod as PayBillInput['method'],
    })
    setPaying(false)
    if (!res.success) return toast.error(res.error ?? 'Payment failed')
    toast.success(
      `Paid ${formatCurrency(amtCents)} — payment ${res.data?.payment.paymentNumber ?? ''}`
    )
    setPayOpen(false)
    setPayAmount('')
    queryClient.invalidateQueries({ queryKey: queryKeys.bills.all })
    await refresh()
  }

  if (loading) return <Skeleton className="h-64 m-6" />

  // ── New-bill composer ─────────────────────────────────────────────────────
  if (isNew) {
    return (
      <div className="p-6 space-y-4 max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold">New supplier bill</h1>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Header</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-4">
                <Label>Supplier *</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                <Label>Supplier ref</Label>
                <Input
                  value={supplierBillRef}
                  onChange={(e) => setSupplierBillRef(e.target.value)}
                  placeholder="Their invoice number"
                />
              </div>
              <div className="col-span-2">
                <Label>Issue date</Label>
                <Input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
              <div className="col-span-3">
                <Label>Due date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <div className="mt-3">
              <Label>Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Line items</CardTitle>
            <Button variant="ghost" onClick={addLine}>
              Add line
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Expense account</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Tax %</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Input
                        value={l.description}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={l.expenseAccountId}
                        onValueChange={(v) => updateLine(idx, { expenseAccountId: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {expenseAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.code} — {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={l.quantity}
                        onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={l.unitPrice}
                        onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={l.taxRate}
                        onChange={(e) => updateLine(idx, { taxRate: e.target.value })}
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length === 1}
                        aria-label="Delete"
                      >
                        <Trash2 className="size-4 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end">
              <div className="w-72 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal (estimated)</span>
                  <span className="font-mono">{formatCurrency(newTotals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax (estimated)</span>
                  <span className="font-mono">{formatCurrency(newTotals.tax)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <span>Total (estimated)</span>
                  <span className="font-mono">{formatCurrency(newTotals.total)}</span>
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  Estimated preview — the exact totals are computed by the server when the draft is
                  saved.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate('/bills')}>
            Cancel
          </Button>
          <Button onClick={onCreate} disabled={creating}>
            {creating ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────────────────────
  if (!bill) return <div className="p-6 text-red-600">Bill not found</div>
  const isDraft = bill.status === 'draft'
  const isOpen = bill.status === 'posted' || bill.status === 'partially_paid'

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{bill.billNumber}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <Badge variant="outline" className="mr-2">
              {bill.status}
            </Badge>
            {bill.supplier?.name ?? '—'} · issued {bill.issueDate} · due {bill.dueDate}
            {bill.supplierBillRef ? ` · ref ${bill.supplierBillRef}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate('/bills')}>
            Back
          </Button>
          {isDraft && (
            <Button onClick={onPost} disabled={posting}>
              {posting ? 'Posting…' : 'Post bill'}
            </Button>
          )}
          {isOpen && (
            <Button variant="default" onClick={() => setPayOpen(true)} disabled={paying}>
              Record payment
            </Button>
          )}
          {(isDraft || isOpen) && bill.amountPaid === 0 && (
            <Button variant="destructive" onClick={() => setVoidOpen(true)}>
              Void
            </Button>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Expense acct</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bill.lines?.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-xs font-mono">
                    {l.expenseAccount?.code ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">{l.quantity}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(l.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {l.taxAmount > 0 ? formatCurrency(l.taxAmount) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(l.lineTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end mt-3">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-mono">{formatCurrency(bill.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span className="font-mono">{formatCurrency(bill.taxTotal)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span className="font-mono">{formatCurrency(bill.total)}</span>
              </div>
              <div className="flex justify-between">
                <span>Paid</span>
                <span className="font-mono">{formatCurrency(bill.amountPaid)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Balance</span>
                <span className="font-mono">{formatCurrency(bill.balance)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <VoidDocumentDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        documentLabel="bill"
        onConfirm={onVoid}
      />

      <Dialog open={payOpen} onOpenChange={(o) => (paying ? null : setPayOpen(o))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record bill payment</DialogTitle>
            <DialogDescription>
              Posts DR Accounts Payable / CR cash. Reduces the bill balance and the supplier
              sub-ledger.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount (max {formatCurrency(bill.balance)})</Label>
              <Input
                type="number"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                disabled={paying}
              />
            </div>
            <div>
              <Label>Method</Label>
              <PaymentMethodSelect
                value={payMethod}
                onValueChange={setPayMethod}
                disabled={paying}
                placeholder="Select method"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayOpen(false)} disabled={paying}>
              Cancel
            </Button>
            <Button onClick={onPay} disabled={paying}>
              {paying ? 'Recording…' : 'Record payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
