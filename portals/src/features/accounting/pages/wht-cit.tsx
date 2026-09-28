import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, Loader2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type CitInstallment,
  type CitObligationEntry,
  createWhtCertificate,
  getTaxObligations,
  listCitInstallments,
  listWhtCertificates,
  payCitInstallment,
  remitWhtCertificate,
  type TaxObligations,
  upsertCitInstallment,
  type WhtCertificate,
} from '@/lib/actions/wht-cit'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { Textarea } from '@/shared/components/ui/textarea'
import { centsToInput, formatCurrency, inputToCents } from '@/shared/utils/currency'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i)

function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ── WHT Certificate form ──────────────────────────────────────────────────────

function WhtCertDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [partyType, setPartyType] = useState<'specialist' | 'supplier'>('specialist')
  const [partyId, setPartyId] = useState('')
  const [taxYear, setTaxYear] = useState(String(CURRENT_YEAR))
  const [taxMonth, setTaxMonth] = useState('')
  const [certRef, setCertRef] = useState('')
  const [grossAmount, setGrossAmount] = useState('')
  const [whtRate, setWhtRate] = useState('')
  const [notes, setNotes] = useState('')

  const grossCents = inputToCents(grossAmount)
  const rateFraction = (Number(whtRate) || 0) / 100
  const whtCents = Math.round(grossCents * rateFraction)

  const mutation = useApiMutation<WhtCertificate, void>(
    () =>
      createWhtCertificate({
        partyType,
        partyId: partyId.trim(),
        taxYear: Number(taxYear),
        taxMonth: taxMonth ? Number(taxMonth) : undefined,
        certificateRef: certRef.trim() || undefined,
        grossAmount: grossCents,
        whtRate: rateFraction,
        whtAmount: whtCents,
        notes: notes.trim() || undefined,
      }),
    {
      onSuccess: () => {
        toast.success('WHT certificate recorded')
        onSaved()
        onOpenChange(false)
      },
      onError: (err) => toast.error(err.message || 'Failed to create certificate'),
    }
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record WHT Certificate</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Party type</Label>
              <Select
                value={partyType}
                onValueChange={(v) => setPartyType(v as 'specialist' | 'supplier')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="specialist">Specialist</SelectItem>
                  <SelectItem value="supplier">Supplier</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tax year</Label>
              <Select value={taxYear} onValueChange={setTaxYear}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Party ID (UUID)</Label>
            <Input
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              placeholder="Specialist or supplier UUID"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Certificate ref (optional)</Label>
              <Input
                value={certRef}
                onChange={(e) => setCertRef(e.target.value)}
                placeholder="e.g. WHT-2026-001"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Month (optional)</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={taxMonth}
                onChange={(e) => setTaxMonth(e.target.value)}
                placeholder="1–12"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Gross amount (GHS)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={grossAmount}
                onChange={(e) => setGrossAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>WHT rate (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={whtRate}
                onChange={(e) => setWhtRate(e.target.value)}
                placeholder="e.g. 5"
              />
            </div>
          </div>

          {grossAmount && whtRate && (
            <p className="text-sm text-muted-foreground">
              WHT amount:{' '}
              <span className="font-semibold text-foreground">{formatCurrency(whtCents)}</span>
            </p>
          )}

          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !partyId.trim() || !grossAmount || !whtRate}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── CIT Installment form ──────────────────────────────────────────────────────

function CITDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [taxYear, setTaxYear] = useState(String(CURRENT_YEAR))
  const [quarter, setQuarter] = useState('1')
  const [dueDate, setDueDate] = useState('')
  const [estimatedAmount, setEstimatedAmount] = useState('')
  const [notes, setNotes] = useState('')

  const mutation = useApiMutation<CitInstallment, void>(
    () =>
      upsertCitInstallment({
        taxYear: Number(taxYear),
        quarter: Number(quarter),
        dueDate,
        estimatedAmount: estimatedAmount ? inputToCents(estimatedAmount) : undefined,
        notes: notes.trim() || undefined,
      }),
    {
      onSuccess: () => {
        toast.success('CIT installment saved')
        onSaved()
        onOpenChange(false)
      },
      onError: (err) => toast.error(err.message || 'Failed to save CIT installment'),
    }
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add / Update CIT Installment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tax year</Label>
              <Select value={taxYear} onValueChange={setTaxYear}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Quarter</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Q1 (Jan–Mar)</SelectItem>
                  <SelectItem value="2">Q2 (Apr–Jun)</SelectItem>
                  <SelectItem value="3">Q3 (Jul–Sep)</SelectItem>
                  <SelectItem value="4">Q4 (Oct–Dec)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Due date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Estimated amount (GHS, optional)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={estimatedAmount}
              onChange={(e) => setEstimatedAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !dueDate}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Pay CIT dialog ────────────────────────────────────────────────────────────

function PayCITDialog({
  installment,
  open,
  onOpenChange,
  onSaved,
}: {
  installment: CitInstallment | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [paidAmount, setPaidAmount] = useState(
    installment?.estimatedAmount ? centsToInput(installment.estimatedAmount) : ''
  )
  const [paidAt, setPaidAt] = useState('')

  // Key on the id, not the whole object: a background refetch of the CIT list
  // hands back a new `installment` identity for the same row, and depending on
  // the object would re-run this and wipe an amount the user is mid-way through
  // typing. Re-seeding only when the dialog switches installments is enough.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — see above
  useEffect(() => {
    if (installment?.estimatedAmount) {
      setPaidAmount(centsToInput(installment.estimatedAmount))
    } else {
      setPaidAmount('')
    }
    setPaidAt('')
  }, [installment?.id])

  const mutation = useApiMutation<CitInstallment, void>(
    () =>
      payCitInstallment(installment!.id, {
        paidAmount: inputToCents(paidAmount),
        paidAt: paidAt || undefined,
      }),
    {
      onSuccess: () => {
        toast.success('CIT payment recorded')
        onSaved()
        onOpenChange(false)
      },
      onError: (err) => toast.error(err.message || 'Failed to record payment'),
    }
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Record CIT Payment — Q{installment?.quarter} {installment?.taxYear}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Amount paid (GHS)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Payment date (optional)</Label>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !paidAmount}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── WHT table ─────────────────────────────────────────────────────────────────

function WhtTable({
  certs,
  onRemit,
}: {
  certs: WhtCertificate[]
  onRemit: (cert: WhtCertificate) => void
}) {
  if (certs.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">No WHT certificates yet.</p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ref</TableHead>
          <TableHead>Party type</TableHead>
          <TableHead>Year / Month</TableHead>
          <TableHead className="text-right">Gross</TableHead>
          <TableHead className="text-right">WHT</TableHead>
          <TableHead>Issued</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {certs.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="font-mono text-xs">
              {c.certificateRef ?? c.id.slice(0, 8)}
            </TableCell>
            <TableCell className="capitalize">{c.partyType}</TableCell>
            <TableCell>
              {c.taxYear}
              {c.taxMonth ? ` / M${c.taxMonth}` : ''}
            </TableCell>
            <TableCell className="text-right">{formatCurrency(c.grossAmount)}</TableCell>
            <TableCell className="text-right">{formatCurrency(c.whtAmount)}</TableCell>
            <TableCell>{fmtDate(c.issuedAt)}</TableCell>
            <TableCell>
              {c.remittedAt ? (
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                  Remitted
                </Badge>
              ) : (
                <Badge variant="secondary">Pending</Badge>
              )}
            </TableCell>
            <TableCell>
              {!c.remittedAt && (
                <Button variant="ghost" size="sm" onClick={() => onRemit(c)}>
                  Mark remitted
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ── CIT table ─────────────────────────────────────────────────────────────────

function CITTable({
  installments,
  onPay,
}: {
  installments: CitInstallment[]
  onPay: (inst: CitInstallment) => void
}) {
  if (installments.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">No CIT installments yet.</p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Year</TableHead>
          <TableHead>Quarter</TableHead>
          <TableHead>Due date</TableHead>
          <TableHead className="text-right">Estimated</TableHead>
          <TableHead className="text-right">Paid</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {installments.map((inst) => (
          <TableRow key={inst.id}>
            <TableCell>{inst.taxYear}</TableCell>
            <TableCell>Q{inst.quarter}</TableCell>
            <TableCell>{fmtDate(inst.dueDate)}</TableCell>
            <TableCell className="text-right">
              {inst.estimatedAmount != null ? formatCurrency(inst.estimatedAmount) : '—'}
            </TableCell>
            <TableCell className="text-right">
              {inst.paidAmount != null ? formatCurrency(inst.paidAmount) : '—'}
            </TableCell>
            <TableCell>
              {inst.paidAt ? (
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                  Paid
                </Badge>
              ) : (
                <Badge variant="secondary">Pending</Badge>
              )}
            </TableCell>
            <TableCell>
              {!inst.paidAt && (
                <Button variant="ghost" size="sm" onClick={() => onPay(inst)}>
                  Record payment
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ── Tax Obligations tab ───────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const CIT_STATUS_CONFIG: Record<
  CitObligationEntry['status'],
  { label: string; cls: string; icon: React.ReactNode }
> = {
  paid: {
    label: 'Paid',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  overdue: {
    label: 'Overdue',
    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  due: {
    label: 'Due Soon',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  upcoming: {
    label: 'Upcoming',
    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    icon: null,
  },
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function TaxObligationsTab({
  taxYear,
  taxMonth,
  onMonthChange,
}: {
  taxYear: number
  taxMonth: number
  onMonthChange: (m: number) => void
}) {
  const { data, isLoading } = useApiQuery<TaxObligations>(
    queryKeys.whtCit.taxObligations(taxYear, taxMonth),
    () => getTaxObligations({ year: taxYear, month: taxMonth })
  )

  return (
    <div className="space-y-6">
      {/* Month picker for PAYE/SSNIT */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Payroll month:</span>
        <Select value={String(taxMonth)} onValueChange={(v) => onMonthChange(Number(v))}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.map((name, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : data ? (
        <>
          {/* PAYE / SSNIT */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">PAYE &amp; SSNIT</h3>
              {data.payroll ? (
                <span className="text-xs text-muted-foreground">
                  {data.payroll.name} · {data.payroll.staffCount} staff ·{' '}
                  <span className="capitalize">{data.payroll.status}</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  No locked/published payroll run for {MONTH_NAMES[taxMonth - 1]} {taxYear}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="PAYE Withheld"
                value={formatCurrency(data.payroll?.paye ?? 0)}
                sub="Due to GRA"
              />
              <StatCard
                label="SSNIT Employee"
                value={formatCurrency(data.payroll?.ssnitEmployee ?? 0)}
                sub="13.5%"
              />
              <StatCard
                label="SSNIT Employer"
                value={formatCurrency(data.payroll?.ssnitEmployer ?? 0)}
                sub="13%"
              />
              <StatCard
                label="Gross Payroll"
                value={formatCurrency(data.payroll?.totalGross ?? 0)}
              />
            </div>
          </div>

          {/* WHT YTD */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">WHT Certificates YTD ({taxYear})</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Total Issued"
                value={formatCurrency(data.whtYtd.totalAmount)}
                sub={`${data.whtYtd.count} certificates`}
              />
              <StatCard
                label="Remitted to GRA"
                value={formatCurrency(data.whtYtd.remittedAmount)}
                sub={`${data.whtYtd.remittedCount} remitted`}
              />
              <StatCard
                label="Outstanding"
                value={formatCurrency(data.whtYtd.outstandingAmount)}
                sub={`${data.whtYtd.count - data.whtYtd.remittedCount} pending`}
              />
            </div>
          </div>

          {/* CIT Q1–Q4 */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">CIT Installments ({taxYear})</h3>
            {data.cit.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No CIT installments recorded for {taxYear}.
              </p>
            ) : (
              <div className="rounded-lg border divide-y">
                {data.cit.map((entry) => {
                  const cfg = CIT_STATUS_CONFIG[entry.status]
                  return (
                    <div key={entry.id} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium w-6">Q{entry.quarter}</span>
                        <span className="text-xs text-muted-foreground">
                          Due {fmtDate(entry.dueDate)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        {entry.estimatedAmount != null && (
                          <span className="text-sm text-muted-foreground">
                            Est. {formatCurrency(entry.estimatedAmount)}
                          </span>
                        )}
                        {entry.paidAmount != null && (
                          <span className="text-sm font-medium">
                            Paid {formatCurrency(entry.paidAmount)}
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className={`flex items-center gap-1 text-xs ${cfg.cls}`}
                        >
                          {cfg.icon}
                          {cfg.label}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WhtCitPage() {
  const qc = useQueryClient()
  const [taxYear, setTaxYear] = useState(CURRENT_YEAR)
  const [taxMonth, setTaxMonth] = useState(new Date().getMonth() + 1)
  const [whtDialogOpen, setWhtDialogOpen] = useState(false)
  const [citDialogOpen, setCitDialogOpen] = useState(false)
  const [_remitTarget, setRemitTarget] = useState<WhtCertificate | null>(null)
  const [payTarget, setPayTarget] = useState<CitInstallment | null>(null)

  const { data: certs = [], isLoading: certsLoading } = useApiQuery<WhtCertificate[]>(
    queryKeys.whtCit.whtList(taxYear),
    () => listWhtCertificates({ taxYear })
  )

  const { data: installments = [], isLoading: citLoading } = useApiQuery<CitInstallment[]>(
    queryKeys.whtCit.citList(taxYear),
    () => listCitInstallments({ taxYear })
  )

  const remitMutation = useApiMutation<WhtCertificate, string>(remitWhtCertificate, {
    invalidates: [queryKeys.whtCit.whtList(taxYear)],
    onSuccess: () => {
      toast.success('WHT certificate marked as remitted')
      setRemitTarget(null)
    },
    onError: (err) => toast.error(err.message || 'Failed to mark as remitted'),
  })

  function invalidateBoth() {
    qc.invalidateQueries({ queryKey: queryKeys.whtCit.whtList(taxYear) })
    qc.invalidateQueries({ queryKey: queryKeys.whtCit.citList(taxYear) })
  }

  const yearSelector = (
    <Select value={String(taxYear)} onValueChange={(v) => setTaxYear(Number(v))}>
      <SelectTrigger className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {YEARS.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {y}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">WHT &amp; CIT</h1>
          <p className="text-sm text-muted-foreground">
            Withholding tax certificates and corporate income tax installments.
          </p>
        </div>
        {yearSelector}
      </div>

      <Tabs defaultValue="obligations">
        <TabsList>
          <TabsTrigger value="obligations">Tax Obligations</TabsTrigger>
          <TabsTrigger value="wht">WHT Certificates</TabsTrigger>
          <TabsTrigger value="cit">CIT Installments</TabsTrigger>
        </TabsList>

        <TabsContent value="obligations" className="mt-4">
          <TaxObligationsTab taxYear={taxYear} taxMonth={taxMonth} onMonthChange={setTaxMonth} />
        </TabsContent>

        <TabsContent value="wht" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button size="sm" onClick={() => setWhtDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Record certificate
            </Button>
          </div>
          {certsLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <WhtTable
              certs={certs}
              onRemit={(c) => {
                setRemitTarget(c)
                remitMutation.mutate(c.id)
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="cit" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button size="sm" onClick={() => setCitDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add installment
            </Button>
          </div>
          {citLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <CITTable installments={installments} onPay={(inst) => setPayTarget(inst)} />
          )}
        </TabsContent>
      </Tabs>

      <WhtCertDialog
        open={whtDialogOpen}
        onOpenChange={setWhtDialogOpen}
        onSaved={invalidateBoth}
      />
      <CITDialog open={citDialogOpen} onOpenChange={setCitDialogOpen} onSaved={invalidateBoth} />
      <PayCITDialog
        installment={payTarget}
        open={!!payTarget}
        onOpenChange={(v) => {
          if (!v) setPayTarget(null)
        }}
        onSaved={() => {
          setPayTarget(null)
          qc.invalidateQueries({ queryKey: queryKeys.whtCit.citList(taxYear) })
        }}
      />
    </div>
  )
}
