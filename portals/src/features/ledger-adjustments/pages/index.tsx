import {
  AlertCircle,
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Paperclip,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  TreatmentPaymentInput,
  type TreatmentPaymentItem,
} from '@/features/payments/components/treatment-payment-input'
import {
  type AdjustmentPayment,
  createLedgerExpense,
  createOneTimeAdjustment,
  createPlanInstallmentAdjustment,
  getLedgerPatients,
  getPatientOneTimePayments,
  getPatientPlanDetails,
  getRecentAdjustments,
  importBulkExpenses,
  importBulkPayments,
  type LedgerPatient,
  type OneTimePayment,
  type PlanDetails,
  quickCreatePatients,
  transferPaymentToPlan,
} from '@/lib/actions/ledger-adjustments'
import { uploadExpenseFile } from '@/lib/actions/upload'
import { PatientPicker } from '@/shared/components/patient-picker'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useLookup } from '@/shared/hooks/use-lookup'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO, parseLocalDate } from '@/shared/lib/dates'
import {
  type CsvTransformResult,
  transformAndValidatePaymentCsv,
} from '@/shared/utils/csv-transformer'
import { formatAmount as formatCents } from '@/shared/utils/currency'

const DEFAULT_EXPENSE_CATEGORIES = ['rent', 'supplies', 'payroll', 'utilities', 'other'] as const

/** Cents in, `GHS 1,234.50` out. */
function formatAmount(amount: number) {
  return `GHS ${formatCents(amount)}`
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-GH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function todayDate() {
  return localDateISO()
}

// PatientCombobox removed — every callsite now uses the shared <PatientPicker>
// directly. Local `LedgerPatient` shape is compatible because PatientPicker
// only needs `{id, name, patientId, …}` and tolerates extra fields.

// ─── Plan Summary Card ─────────────────────────────────────────────────────────

function PlanSummaryCard({ details }: { details: PlanDetails }) {
  const { plan, totalPaid, remaining } = details
  const progressPct = Math.min(100, Math.round((totalPaid / plan.totalAmount) * 100))

  return (
    <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Payment Plan</span>
        <Badge
          variant={
            plan.status === 'completed'
              ? 'default'
              : plan.status === 'overdue' || plan.status === 'outstanding'
                ? 'destructive'
                : 'secondary'
          }
          className="capitalize"
        >
          {plan.status}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="font-semibold text-sm">{formatAmount(plan.totalAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Paid</p>
          <p className="font-semibold text-sm text-green-600">{formatAmount(totalPaid)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Remaining</p>
          <p className="font-semibold text-sm text-amber-600">{formatAmount(remaining)}</p>
        </div>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-green-500 rounded-full transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      {plan.amountPerInstallment && (
        <p className="text-xs text-muted-foreground">
          Installment: {formatAmount(plan.amountPerInstallment)}
          {plan.paymentFrequency ? ` · ${plan.paymentFrequency}` : ''}
        </p>
      )}
    </div>
  )
}

// ─── Recent Adjustments Table ──────────────────────────────────────────────────

function RecentAdjustmentsTable({
  adjustments,
  patients,
  loading,
}: {
  adjustments: AdjustmentPayment[]
  patients: LedgerPatient[]
  loading: boolean
}) {
  const patientMap = Object.fromEntries(patients.map((p) => [p.id, p]))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Ledger Adjustments</CardTitle>
        <CardDescription>Last 30 adjustments recorded in the system</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No ledger adjustments recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Patient</th>
                  <th className="text-left py-2 pr-4 font-medium">Date</th>
                  <th className="text-right py-2 pr-4 font-medium">Amount</th>
                  <th className="text-left py-2 pr-4 font-medium">Method</th>
                  <th className="text-left py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((adj) => {
                  const patient = patientMap[adj.patientId]
                  const isInstallment = !!adj.paymentPlanId
                  return (
                    <tr key={adj.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-4">
                        {patient ? patient.name : adj.patientId}
                        {isInstallment && (
                          <span className="ml-1 text-xs text-blue-500">(plan)</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {formatDate(adj.createdAt)}
                      </td>
                      <td className="py-2 pr-4 text-right font-medium">
                        {formatAmount(adj.amount)}
                      </td>
                      <td className="py-2 pr-4 capitalize text-muted-foreground">
                        {adj.method.replace('_', ' ')}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground max-w-xs truncate">
                        {adj.description ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function LedgerAdjustmentsPage() {
  const [patients, setPatients] = useState<LedgerPatient[]>([])
  const [patientsLoading, setPatientsLoading] = useState(true)

  const [adjustments, setAdjustments] = useState<AdjustmentPayment[]>([])
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(true)

  // One-time form state
  const [otPatientId, setOtPatientId] = useState('')
  const [otTreatments, setOtTreatments] = useState<TreatmentPaymentItem[]>([])
  const [otMethod, setOtMethod] = useState('')
  const [otDate, setOtDate] = useState(todayDate())
  const [otReason, setOtReason] = useState('')
  const { isSubmitting: otSubmitting, submit: otSubmit } = useSubmitGuard()

  // Transfer tab state
  const [trPatientId, setTrPatientId] = useState('')
  const [trPlanDetails, setTrPlanDetails] = useState<PlanDetails | null>(null)
  const [trPlanLoading, setTrPlanLoading] = useState(false)
  const [trPayments, setTrPayments] = useState<OneTimePayment[]>([])
  const [trPaymentsLoading, setTrPaymentsLoading] = useState(false)
  const [trTransferring, setTrTransferring] = useState<string | null>(null)

  // Plan installment form state
  const [piPatientId, setPiPatientId] = useState('')
  const [piPlanDetails, setPiPlanDetails] = useState<PlanDetails | null>(null)
  const [piPlanLoading, setPiPlanLoading] = useState(false)
  const [piTreatments, setPiTreatments] = useState<TreatmentPaymentItem[]>([])
  const [piMethod, setPiMethod] = useState('')
  const [piDate, setPiDate] = useState(todayDate())
  const [piReason, setPiReason] = useState('')
  const { isSubmitting: piSubmitting, submit: piSubmit } = useSubmitGuard()

  // Shared expense-categories lookup — refreshes when Settings edits it, no reload.
  const { rows: expCategoryRows } = useLookup('expense-categories')
  const expCategories = expCategoryRows.map((c) => c.name)

  // Expense single entry
  const [expCategory, setExpCategory] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expDate, setExpDate] = useState(todayDate())
  const [expDescription, setExpDescription] = useState('')
  const [expPaidTo, setExpPaidTo] = useState('')
  const [expMethod, setExpMethod] = useState('')
  const [expReason, setExpReason] = useState('')
  const [expAttachment, setExpAttachment] = useState<File | null>(null)
  const { isSubmitting: expSubmitting, submit: expSubmit } = useSubmitGuard()

  // Expense bulk import
  const [expFile, setExpFile] = useState<File | null>(null)
  const [expAttachments, setExpAttachments] = useState<FileList | null>(null)
  const [expImporting, setExpImporting] = useState(false)
  const [expImportResult, setExpImportResult] = useState<{
    message?: string
    errors?: string[]
  } | null>(null)

  // Payments bulk import
  const [pmtFile, setPmtFile] = useState<File | null>(null)
  const [pmtValidating, setPmtValidating] = useState(false)
  const [pmtValidation, setPmtValidation] = useState<CsvTransformResult | null>(null)
  const [pmtCreating, setPmtCreating] = useState(false)
  const [pmtImporting, setPmtImporting] = useState(false)
  const [pmtImportResult, setPmtImportResult] = useState<{
    message?: string
    errors?: string[]
  } | null>(null)

  const loadPatients = useCallback(async () => {
    setPatientsLoading(true)
    const res = await getLedgerPatients()
    if (res.success && res.data) setPatients(res.data)
    setPatientsLoading(false)
  }, [])

  const loadAdjustments = useCallback(async () => {
    setAdjustmentsLoading(true)
    const res = await getRecentAdjustments()
    if (res.success && res.data) setAdjustments(res.data)
    setAdjustmentsLoading(false)
  }, [])

  useEffect(() => {
    loadPatients()
    loadAdjustments()
  }, [loadPatients, loadAdjustments])

  // Load plan details when patient selected in Plan Installment tab
  useEffect(() => {
    if (!piPatientId) {
      setPiPlanDetails(null)
      return
    }
    ;(async () => {
      setPiPlanLoading(true)
      const res = await getPatientPlanDetails(piPatientId)
      if (res.success && res.data) {
        setPiPlanDetails(res.data)
      } else {
        setPiPlanDetails(null)
      }
      setPiPlanLoading(false)
    })()
  }, [piPatientId])

  // Load plan + one-time payments when patient selected in Transfer tab
  useEffect(() => {
    if (!trPatientId) {
      setTrPlanDetails(null)
      setTrPayments([])
      return
    }
    ;(async () => {
      setTrPlanLoading(true)
      setTrPaymentsLoading(true)
      const [planRes, paymentsRes] = await Promise.all([
        getPatientPlanDetails(trPatientId),
        getPatientOneTimePayments(trPatientId),
      ])
      setTrPlanDetails(planRes.success && planRes.data ? planRes.data : null)
      setTrPayments(paymentsRes.success && paymentsRes.data ? paymentsRes.data : [])
      setTrPlanLoading(false)
      setTrPaymentsLoading(false)
    })()
  }, [trPatientId])

  async function handleTransferToPlan(paymentId: string) {
    setTrTransferring(paymentId)
    const res = await transferPaymentToPlan({ paymentId, patientId: trPatientId })
    setTrTransferring(null)
    if (res.success && res.data) {
      if (res.data.planCompleted) {
        toast.success('Payment transferred and plan marked as completed!')
      } else {
        toast.success(
          `Payment transferred. Remaining balance: ${formatAmount(res.data.newBalance)}`
        )
      }
      // Refresh data
      const [planRes, paymentsRes] = await Promise.all([
        getPatientPlanDetails(trPatientId),
        getPatientOneTimePayments(trPatientId),
      ])
      setTrPlanDetails(planRes.success && planRes.data ? planRes.data : null)
      setTrPayments(paymentsRes.success && paymentsRes.data ? paymentsRes.data : [])
      loadAdjustments()
    } else {
      surfaceApiError(res, 'Failed to transfer payment.')
    }
  }

  // ── One-Time Submit ──
  async function handleOneTimeSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!otPatientId || !otMethod || !otDate || otTreatments.length === 0) {
      toast.error('Please fill in all required fields and add at least one treatment.')
      return
    }
    if (otTreatments.some((t) => t.amount <= 0 || !t.treatmentId)) {
      toast.error('All treatments must have a valid selected type and an amount greater than 0.')
      return
    }
    await otSubmit(async () => {
      const totalAmount = otTreatments.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
      const treatmentNames = otTreatments.map((t) => t.name).join(', ')
      const res = await createOneTimeAdjustment({
        patientId: otPatientId,
        amount: totalAmount,
        method: otMethod,
        description: treatmentNames,
        transactionDate: otDate,
        reason: otReason.trim() || undefined,
        treatments: otTreatments,
      })
      if (res.success) {
        toast.success('One-time payment recorded successfully.')
        setOtPatientId('')
        setOtTreatments([])
        setOtMethod('')
        setOtDate(todayDate())
        setOtReason('')
        loadAdjustments()
      } else {
        surfaceApiError(res, 'Failed to record adjustment.')
      }
    })
  }

  // ── Plan Installment Submit ──
  async function handlePlanInstallmentSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!piPatientId || !piMethod || !piDate || piTreatments.length === 0) {
      toast.error('Please fill in all required fields and add at least one treatment.')
      return
    }
    if (piTreatments.some((t) => t.amount <= 0 || !t.treatmentId)) {
      toast.error('All treatments must have a valid selected type and an amount greater than 0.')
      return
    }
    if (!piPlanDetails) {
      toast.error('No payment plan found for this patient.')
      return
    }
    const totalAmount = piTreatments.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
    if (totalAmount > piPlanDetails.remaining) {
      toast.error(
        `Payment of ${formatAmount(totalAmount)} exceeds the remaining plan balance of ${formatAmount(piPlanDetails.remaining)}. Please reduce the amount.`
      )
      return
    }
    await piSubmit(async () => {
      const treatmentNames = piTreatments.map((t) => t.name).join(', ')
      const res = await createPlanInstallmentAdjustment({
        patientId: piPatientId,
        amount: totalAmount,
        method: piMethod,
        description: treatmentNames,
        transactionDate: piDate,
        reason: piReason.trim() || undefined,
        treatments: piTreatments,
      })
      if (res.success && res.data) {
        if (res.data.planCompleted) {
          toast.success('Installment recorded and plan marked as completed!')
        } else {
          toast.success(
            `Installment recorded. Remaining balance: ${formatAmount(res.data.newBalance)}`
          )
        }
        setPiPatientId('')
        setPiPlanDetails(null)
        setPiTreatments([])
        setPiMethod('')
        setPiDate(todayDate())
        setPiReason('')
        loadAdjustments()
      } else {
        surfaceApiError(res, 'Failed to record installment adjustment.')
      }
    })
  }

  // ── Expense Single Entry Submit ──
  async function handleExpenseSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!expCategory || !expAmount || !expDate) {
      toast.error('Category, amount, and date are required.')
      return
    }
    const parsed = parseFloat(expAmount)
    if (Number.isNaN(parsed) || parsed < 0.01) {
      toast.error('Enter a valid amount of at least GHS 0.01.')
      return
    }
    await expSubmit(async () => {
      let attachmentUrl: string | undefined
      if (expAttachment) {
        const uploadRes = await uploadExpenseFile({
          file: expAttachment,
          category: expCategory,
          paidTo: expPaidTo || null,
          date: parseLocalDate(expDate),
        })
        if (!uploadRes.success) {
          toast.error(`Attachment upload failed: ${uploadRes.error ?? 'Unknown error'}`)
          return
        }
        attachmentUrl = uploadRes.url
      }

      const res = await createLedgerExpense({
        category: expCategory,
        amount: parsed,
        date: expDate,
        description: expDescription || undefined,
        paidTo: expPaidTo || undefined,
        paymentMethod: expMethod || undefined,
        reason: expReason || undefined,
        attachmentUrl,
      })
      if (res.success) {
        toast.success('Expense recorded successfully.')
        setExpCategory('')
        setExpAmount('')
        setExpDate(todayDate())
        setExpDescription('')
        setExpPaidTo('')
        setExpMethod('')
        setExpReason('')
        setExpAttachment(null)
      } else {
        surfaceApiError(res, 'Failed to record expense.')
      }
    })
  }

  // ── Bulk Expense Import Submit ──
  async function handleBulkExpenseImport() {
    if (!expFile) {
      toast.error('Please select a CSV file.')
      return
    }
    setExpImporting(true)
    setExpImportResult(null)
    const fd = new FormData()
    fd.append('csv', expFile)
    if (expAttachments) {
      for (let i = 0; i < expAttachments.length; i++) {
        fd.append('attachments', expAttachments[i])
      }
    }
    const res = await importBulkExpenses(fd)
    setExpImporting(false)
    if (res.success) {
      const msg = (res.data as any)?.message || 'Import successful.'
      const errs = (res.data as any)?.errors as string[] | undefined
      setExpImportResult({ message: msg, errors: errs?.length ? errs : undefined })
      setExpFile(null)
      setExpAttachments(null)
      toast.success('Bulk import completed.')
    } else {
      const errors = (res.data as any)?.errors as string[] | undefined
      setExpImportResult({ errors: errors?.length ? errors : [res.error || 'Import failed.'] })
    }
  }

  // ── Download expense CSV template ──
  function downloadExpenseTemplate() {
    const header = 'Date,Amount,Category,Description,PaidTo,Method,Attachment'
    const sample = `${todayDate()},500.00,supplies,Office supplies purchase,Vendor Name,cash,/receipt.jpg`
    const content = [header, sample].join('\n')
    const blob = new Blob([content], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'expenses_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Validate CSV on file select ──
  async function handlePmtFileChange(file: File | null) {
    setPmtFile(file)
    setPmtValidation(null)
    setPmtImportResult(null)
    if (!file) return
    if (patientsLoading) {
      toast.error('Patient list is still loading — try again in a moment.')
      return
    }
    setPmtValidating(true)
    const result = await transformAndValidatePaymentCsv(file, patients)
    setPmtValidation(result)
    setPmtValidating(false)
  }

  // ── Create missing patients then re-validate ──
  async function handleCreateMissingPatients() {
    if (!pmtValidation || pmtValidation.missingPatientNames.length === 0 || !pmtFile) return
    setPmtCreating(true)
    const res = await quickCreatePatients(pmtValidation.missingPatientNames)
    if (res.success) {
      const { message, created, skipped } = res.data!
      toast.success(message)
      // Reload patients list so the new records are available for re-validation
      await loadPatients()
      // Re-validate using the freshly reloaded list — fetch directly to avoid stale closure
      const freshRes = await import('@/lib/actions/ledger-adjustments').then((m) =>
        m.getLedgerPatients()
      )
      if (!freshRes.success || !freshRes.data) {
        toast.error('Could not reload patient list — please refresh and try again.')
        setPmtCreating(false)
        return
      }
      const freshPatients = freshRes.data
      setPmtValidating(true)
      const result = await transformAndValidatePaymentCsv(pmtFile, freshPatients)
      setPmtValidation(result)
      setPmtValidating(false)
    } else {
      surfaceApiError(res, 'Failed to create patients.')
    }
    setPmtCreating(false)
  }

  // ── Bulk Payments Import Submit ──
  async function handleBulkPaymentsImport() {
    if (!pmtValidation || pmtValidation.validRows.length === 0) {
      toast.error('No valid rows to import.')
      return
    }
    setPmtImporting(true)
    setPmtImportResult(null)
    // Build a File from the upload-ready CSV (valid rows only)
    const csvBlob = new Blob([pmtValidation.uploadCsv], { type: 'text/csv' })
    const csvFile = new File([csvBlob], 'payments.csv', { type: 'text/csv' })
    const fd = new FormData()
    fd.append('csv', csvFile)
    const res = await importBulkPayments(fd)
    setPmtImporting(false)
    if (res.success) {
      const msg = (res.data as any)?.message || 'Import successful.'
      const errs = (res.data as any)?.errors as string[] | undefined
      setPmtImportResult({ message: msg, errors: errs?.length ? errs : undefined })
      setPmtFile(null)
      setPmtValidation(null)
      toast.success('Bulk payments import completed.')
    } else {
      const errors = (res.data as any)?.errors as string[] | undefined
      setPmtImportResult({ errors: errors?.length ? errors : [res.error || 'Import failed.'] })
    }
  }

  // ── Download converted CSV ──
  function downloadConvertedCsv() {
    if (!pmtValidation?.transformedCsv) return
    const blob = new Blob([pmtValidation.transformedCsv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'payments_converted.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Download payments CSV template ──
  function downloadPaymentsTemplate() {
    const header = 'PatientName,PatientPhone,Type,Amount,Method,Date,Description,Reason'
    const rows = [
      `John Doe,0241234567,one-time,500.00,cash,${todayDate()},Consultation fee,Missed entry from last month`,
      `Jane Smith,,plan-installment,300.00,momo,${todayDate()},Monthly installment,`,
    ]
    const content = [header, ...rows].join('\n')
    const blob = new Blob([content], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'bulk_payments_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BookMarked className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ledger Adjustments</h1>
          <p className="text-sm text-muted-foreground">
            Backdate missed payments into the system. All adjustments are audit-logged.
          </p>
        </div>
      </div>

      {/* Warning Banner */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
        <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
        <p className="text-sm">
          <strong>Admin-only tool.</strong> Transactions recorded here are permanent and backdated.
          They will appear in financial reports for the selected date. Use only for correcting
          genuine missed entries.
        </p>
      </div>

      {/* Forms */}
      <Tabs defaultValue="one-time">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="one-time">One-Time Payment</TabsTrigger>
          <TabsTrigger value="plan-installment">Plan Installment</TabsTrigger>
          <TabsTrigger value="transfer">Transfer to Plan</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="bulk-payments">Bulk Payments</TabsTrigger>
        </TabsList>

        {/* ── One-Time Tab ─────────────────────────── */}
        <TabsContent value="one-time" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Record a Missed One-Time Payment</CardTitle>
              <CardDescription>
                Use this to backdate a standalone payment not linked to any payment plan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleOneTimeSubmit} className="space-y-5">
                {/* Patient */}
                <div className="space-y-2">
                  <Label htmlFor="ot-patient">
                    Patient <span className="text-destructive">*</span>
                  </Label>
                  <PatientPicker
                    id="ot-patient"
                    value={otPatientId}
                    onChange={(id) => setOtPatientId(id)}
                    patients={patients}
                    disabled={patientsLoading}
                  />
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  {/* Method */}
                  <div className="space-y-2">
                    <Label htmlFor="ot-method">
                      Payment Method <span className="text-destructive">*</span>
                    </Label>
                    <PaymentMethodSelect
                      id="ot-method"
                      value={otMethod}
                      onValueChange={setOtMethod}
                      placeholder="Select method"
                    />
                  </div>

                  {/* Date */}
                  <div className="space-y-2">
                    <Label htmlFor="ot-date">
                      Transaction Date <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="ot-date"
                      type="date"
                      max={todayDate()}
                      value={otDate}
                      onChange={(e) => setOtDate(e.target.value)}
                    />
                  </div>

                  {/* Treatments */}
                  <div className="space-y-2 sm:col-span-2">
                    <Label>
                      Treatments <span className="text-destructive">*</span>
                    </Label>
                    <TreatmentPaymentInput value={otTreatments} onChange={setOtTreatments} />
                  </div>
                </div>

                {/* Reason */}
                <div className="space-y-2">
                  <Label htmlFor="ot-reason">Reason / Audit Note</Label>
                  <Input
                    id="ot-reason"
                    maxLength={500}
                    placeholder="Why is this being recorded now? e.g. Payment was received in cash on this date but not entered."
                    value={otReason}
                    onChange={(e) => setOtReason(e.target.value)}
                  />
                </div>

                <Button type="submit" disabled={otSubmitting} className="w-full sm:w-auto">
                  {otSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Record Payment
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Transfer Tab ──────────────────────────── */}
        <TabsContent value="transfer" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transfer One-Time Payment to Plan</CardTitle>
              <CardDescription>
                Select a patient to see their payment plan and existing one-time payments. Click
                "Transfer to Plan" to move a payment into their plan balance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Patient */}
              <div className="space-y-2">
                <Label htmlFor="tr-patient">
                  Patient <span className="text-destructive">*</span>
                </Label>
                <PatientPicker
                  id="tr-patient"
                  value={trPatientId}
                  onChange={(id) => setTrPatientId(id)}
                  patients={patients}
                  disabled={patientsLoading}
                />
              </div>

              {/* Plan summary */}
              {trPatientId && (
                <div>
                  {trPlanLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading plan…
                    </div>
                  ) : trPlanDetails ? (
                    <PlanSummaryCard details={trPlanDetails} />
                  ) : (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      No payment plan found for this patient.
                    </div>
                  )}
                </div>
              )}

              {/* One-time payments list */}
              {trPatientId && trPlanDetails && (
                <div className="space-y-2">
                  <Label>One-Time Payments</Label>
                  {trPaymentsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading payments…
                    </div>
                  ) : trPayments.length === 0 ? (
                    <div className="rounded-lg border bg-muted/40 px-4 py-6 text-sm text-muted-foreground text-center">
                      No one-time payments found for this patient.
                    </div>
                  ) : (
                    <div className="divide-y rounded-lg border overflow-hidden">
                      {trPayments.map((pmt) => {
                        const treatmentLabel =
                          pmt.treatments && pmt.treatments.length > 0
                            ? pmt.treatments.map((t) => t.name).join(', ')
                            : pmt.description || '—'
                        return (
                          <div
                            key={pmt.id}
                            className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/30"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm">{formatAmount(pmt.amount)}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {treatmentLabel}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(pmt.createdAt)} · {pmt.method.replace('_', ' ')}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={trTransferring === pmt.id}
                              onClick={() => handleTransferToPlan(pmt.id)}
                            >
                              {trTransferring === pmt.id && (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              )}
                              Transfer to Plan
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Plan Installment Tab ──────────────────── */}
        <TabsContent value="plan-installment" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Record a Missed Plan Installment</CardTitle>
              <CardDescription>
                Add a backdated installment to a patient's existing payment plan. Balance
                recalculates automatically. Plan closes if fully paid.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePlanInstallmentSubmit} className="space-y-5">
                {/* Patient */}
                <div className="space-y-2">
                  <Label htmlFor="pi-patient">
                    Patient <span className="text-destructive">*</span>
                  </Label>
                  <PatientPicker
                    id="pi-patient"
                    value={piPatientId}
                    onChange={(id) => setPiPatientId(id)}
                    patients={patients}
                    disabled={patientsLoading}
                  />
                </div>

                {/* Plan summary */}
                {piPatientId && (
                  <div>
                    {piPlanLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading plan…
                      </div>
                    ) : piPlanDetails ? (
                      <PlanSummaryCard details={piPlanDetails} />
                    ) : (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        No payment plan found for this patient. Only patients with an existing plan
                        can have installments recorded here.
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  {/* Method */}
                  <div className="space-y-2">
                    <Label htmlFor="pi-method">
                      Payment Method <span className="text-destructive">*</span>
                    </Label>
                    <PaymentMethodSelect
                      id="pi-method"
                      value={piMethod}
                      onValueChange={setPiMethod}
                      placeholder="Select method"
                    />
                  </div>

                  {/* Date */}
                  <div className="space-y-2">
                    <Label htmlFor="pi-date">
                      Transaction Date <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="pi-date"
                      type="date"
                      max={todayDate()}
                      value={piDate}
                      onChange={(e) => setPiDate(e.target.value)}
                    />
                  </div>

                  {/* Treatments */}
                  {piPlanDetails && (
                    <div className="space-y-2 sm:col-span-2">
                      <Label>
                        Treatments <span className="text-destructive">*</span>
                      </Label>
                      <TreatmentPaymentInput
                        value={piTreatments}
                        onChange={setPiTreatments}
                        maxTotalAmount={piPlanDetails ? piPlanDetails.remaining : undefined}
                      />
                    </div>
                  )}
                </div>

                {/* Reason */}
                <div className="space-y-2">
                  <Label htmlFor="pi-reason">Reason / Audit Note</Label>
                  <Input
                    id="pi-reason"
                    maxLength={500}
                    placeholder="Why is this installment being entered now?"
                    value={piReason}
                    onChange={(e) => setPiReason(e.target.value)}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={piSubmitting || !piPlanDetails}
                  className="w-full sm:w-auto"
                >
                  {piSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Record Installment
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
        {/* ── Expenses Tab ──────────────────────────── */}
        <TabsContent value="expenses" className="mt-4 space-y-4">
          {/* Single Entry */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Record a Single Backdated Expense
              </CardTitle>
              <CardDescription>
                Enter one expense record with a custom date. Audit-logged.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleExpenseSubmit} className="space-y-5">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  {/* Category */}
                  <div className="space-y-2">
                    <Label htmlFor="exp-category">
                      Category <span className="text-destructive">*</span>
                    </Label>
                    <Select value={expCategory} onValueChange={setExpCategory}>
                      <SelectTrigger id="exp-category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {(expCategories.length > 0
                          ? expCategories
                          : DEFAULT_EXPENSE_CATEGORIES
                        ).map((cat) => (
                          <SelectItem key={cat} value={cat} className="capitalize">
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Amount */}
                  <div className="space-y-2">
                    <Label htmlFor="exp-amount">
                      Amount (GHS) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="exp-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={expAmount}
                      onChange={(e) => setExpAmount(e.target.value)}
                    />
                  </div>

                  {/* Date */}
                  <div className="space-y-2">
                    <Label htmlFor="exp-date">
                      Expense Date <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="exp-date"
                      type="date"
                      max={todayDate()}
                      value={expDate}
                      onChange={(e) => setExpDate(e.target.value)}
                    />
                  </div>

                  {/* Payment method */}
                  <div className="space-y-2">
                    <Label htmlFor="exp-method">Payment Method</Label>
                    <PaymentMethodSelect
                      id="exp-method"
                      value={expMethod}
                      onValueChange={setExpMethod}
                      placeholder="Select method (optional)"
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <Label htmlFor="exp-desc">Description</Label>
                    <Input
                      id="exp-desc"
                      maxLength={255}
                      placeholder="What was this expense for?"
                      value={expDescription}
                      onChange={(e) => setExpDescription(e.target.value)}
                    />
                  </div>

                  {/* Paid To */}
                  <div className="space-y-2">
                    <Label htmlFor="exp-paidto">Paid To</Label>
                    <Input
                      id="exp-paidto"
                      maxLength={255}
                      placeholder="Vendor or recipient name"
                      value={expPaidTo}
                      onChange={(e) => setExpPaidTo(e.target.value)}
                    />
                  </div>
                </div>

                {/* Attachment */}
                <div className="space-y-2">
                  <Label htmlFor="exp-attachment" className="flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" />
                    Receipt / Attachment
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="exp-attachment"
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setExpAttachment(e.target.files?.[0] ?? null)}
                  />
                  {expAttachment && (
                    <p className="text-xs text-muted-foreground">{expAttachment.name}</p>
                  )}
                </div>

                {/* Reason */}
                <div className="space-y-2">
                  <Label htmlFor="exp-reason">Reason / Audit Note</Label>
                  <Input
                    id="exp-reason"
                    maxLength={500}
                    placeholder="Why is this expense being entered now?"
                    value={expReason}
                    onChange={(e) => setExpReason(e.target.value)}
                  />
                </div>

                <Button type="submit" disabled={expSubmitting} className="w-full sm:w-auto">
                  {expSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Record Expense
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Bulk Import */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Bulk Import Expenses via CSV
              </CardTitle>
              <CardDescription>
                Upload a CSV with columns:{' '}
                <code className="text-xs bg-muted px-1 rounded">
                  Date, Amount, Category, Description, PaidTo, Method, Attachment
                </code>
                . The <strong>Attachment</strong> column should contain relative paths (e.g.{' '}
                <code className="text-xs bg-muted px-1 rounded">/receipt.jpg</code>). Upload the
                matching files separately below — they will be linked automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={downloadExpenseTemplate}>
                  <Download className="mr-2 h-4 w-4" />
                  Download Sample Template
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="exp-file">
                    CSV File <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="exp-file"
                    type="file"
                    accept=".csv"
                    onChange={(e) => {
                      setExpFile(e.target.files?.[0] ?? null)
                      setExpImportResult(null)
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exp-attachments" className="flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" />
                    Attachment Files
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="exp-attachments"
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    onChange={(e) => setExpAttachments(e.target.files)}
                  />
                  {expAttachments && expAttachments.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {expAttachments.length} file(s) selected
                    </p>
                  )}
                </div>
              </div>

              <Button disabled={!expFile || expImporting} onClick={handleBulkExpenseImport}>
                {expImporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Import Expenses
              </Button>

              {expImportResult &&
                (expImportResult.message && !expImportResult.errors ? (
                  <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-700 text-sm">
                    <CheckCircle2 className="h-4 w-4" /> {expImportResult.message}
                  </div>
                ) : expImportResult.message && expImportResult.errors ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-700 text-sm">
                      <CheckCircle2 className="h-4 w-4" /> {expImportResult.message}
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                      <p className="text-amber-800 text-sm font-medium">Some rows had issues:</p>
                      <ul className="text-xs text-amber-800 space-y-0.5 list-disc list-inside">
                        {expImportResult.errors.map((e, i) => (
                          <li key={`${i}-${e}`}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                    <div className="flex items-center gap-2 text-destructive text-sm font-medium">
                      <AlertCircle className="h-4 w-4" /> Import failed — fix errors and retry
                    </div>
                    <ul className="text-xs text-destructive space-y-0.5 list-disc list-inside">
                      {expImportResult.errors?.map((e, i) => (
                        <li key={`${i}-${e}`}>{e}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Bulk Payments Tab ────────────────────── */}
        <TabsContent value="bulk-payments" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Bulk Import Patient Payments via CSV
              </CardTitle>
              <CardDescription className="space-y-1">
                <span className="block">
                  Import multiple backdated patient payments at once. Each row must be linked to a
                  patient. For plan installments, the patient must already have an active payment
                  plan.
                </span>
                <span className="block">
                  Required columns:{' '}
                  <code className="text-xs bg-muted px-1 rounded">
                    PatientName, Type, Amount, Method, Date
                  </code>
                  . Optional:{' '}
                  <code className="text-xs bg-muted px-1 rounded">
                    PatientPhone, Description, Reason
                  </code>
                  .<strong> Type</strong> must be{' '}
                  <code className="text-xs bg-muted px-1 rounded">one-time</code> or{' '}
                  <code className="text-xs bg-muted px-1 rounded">plan-installment</code>. Add{' '}
                  <strong>PatientPhone</strong> when two patients share the same name. Legacy export
                  formats (e.g. <code className="text-xs bg-muted px-1 rounded">PATIENT NAME</code>,{' '}
                  <code className="text-xs bg-muted px-1 rounded">AMOUNT PAID</code>) are
                  automatically converted.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button variant="outline" size="sm" onClick={downloadPaymentsTemplate}>
                <Download className="mr-2 h-4 w-4" />
                Download Sample Template
              </Button>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2 flex-1 min-w-48">
                  <Label htmlFor="pmt-file">
                    CSV File <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="pmt-file"
                    type="file"
                    accept=".csv"
                    onChange={(e) => handlePmtFileChange(e.target.files?.[0] ?? null)}
                  />
                </div>
                <Button
                  disabled={
                    !pmtValidation ||
                    pmtValidation.validRows.length === 0 ||
                    pmtImporting ||
                    pmtValidating
                  }
                  onClick={handleBulkPaymentsImport}
                >
                  {pmtImporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Import{' '}
                      {pmtValidation && pmtValidation.validRows.length > 0
                        ? `${pmtValidation.validRows.length} Row${pmtValidation.validRows.length !== 1 ? 's' : ''}`
                        : 'Payments'}
                    </>
                  )}
                </Button>
              </div>

              {/* ── Validation Results ── */}
              {pmtValidating && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Validating CSV and checking patients…
                </div>
              )}

              {pmtValidation &&
                !pmtValidating &&
                (() => {
                  const {
                    wasTransformed,
                    validRows,
                    invalidRows,
                    missingPatientRows,
                    missingPatientNames,
                    transformedCsv,
                  } = pmtValidation
                  const totalRows =
                    validRows.length + invalidRows.length + missingPatientRows.length
                  return (
                    <div className="space-y-3">
                      {/* Auto-converted notice */}
                      {wasTransformed && (
                        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700 text-sm">
                          <FileText className="h-4 w-4 shrink-0" />
                          Legacy CSV format detected — columns were automatically remapped and
                          amounts/dates normalised.
                          <Button
                            variant="link"
                            size="sm"
                            className="ml-auto h-auto p-0 text-blue-700 text-xs"
                            onClick={downloadConvertedCsv}
                          >
                            <Download className="mr-1 h-3 w-3" /> Download converted CSV
                          </Button>
                        </div>
                      )}

                      {/* Summary row */}
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-center">
                          <p className="text-2xl font-semibold text-green-700">
                            {validRows.length}
                          </p>
                          <p className="text-xs text-green-600">Ready to import</p>
                        </div>
                        <div
                          className={`rounded-lg border px-3 py-2 text-center ${missingPatientRows.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-border bg-muted/40'}`}
                        >
                          <p
                            className={`text-2xl font-semibold ${missingPatientRows.length > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}
                          >
                            {missingPatientRows.length}
                          </p>
                          <p
                            className={`text-xs ${missingPatientRows.length > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}
                          >
                            Patient not found
                          </p>
                        </div>
                        <div
                          className={`rounded-lg border px-3 py-2 text-center ${invalidRows.length > 0 ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-muted/40'}`}
                        >
                          <p
                            className={`text-2xl font-semibold ${invalidRows.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                          >
                            {invalidRows.length}
                          </p>
                          <p
                            className={`text-xs ${invalidRows.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                          >
                            Format errors
                          </p>
                        </div>
                      </div>

                      {totalRows === 0 && (
                        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 text-sm">
                          <AlertCircle className="h-4 w-4" /> The CSV file has no data rows.
                        </div>
                      )}

                      {/* Missing patients */}
                      {missingPatientNames.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                          <p className="text-amber-800 text-sm font-medium flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            {missingPatientNames.length} patient
                            {missingPatientNames.length !== 1 ? 's' : ''} not found in records:
                          </p>
                          <ul className="text-xs text-amber-800 space-y-0.5 list-disc list-inside columns-2">
                            {missingPatientNames.map((name, i) => (
                              <li key={`${i}-${name}`}>{name}</li>
                            ))}
                          </ul>
                          <p className="text-xs text-amber-700">
                            These {missingPatientRows.length} row
                            {missingPatientRows.length !== 1 ? 's' : ''} are currently blocked.
                            Click below to create these patients now using their names — you can
                            fill in their details (DOB, phone, etc.) via their patient profile
                            afterwards.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-amber-400 text-amber-800 hover:bg-amber-100"
                            disabled={pmtCreating || pmtValidating}
                            onClick={handleCreateMissingPatients}
                          >
                            {pmtCreating ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Creating patients…
                              </>
                            ) : (
                              <>
                                Create {missingPatientNames.length} Missing Patient
                                {missingPatientNames.length !== 1 ? 's' : ''}
                              </>
                            )}
                          </Button>
                        </div>
                      )}

                      {/* Format errors */}
                      {invalidRows.length > 0 && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                          <p className="text-destructive text-sm font-medium flex items-center gap-2">
                            <AlertCircle className="h-4 w-4" />
                            {invalidRows.length} row{invalidRows.length !== 1 ? 's' : ''} with
                            format errors (will be skipped):
                          </p>
                          <ul className="text-xs text-destructive space-y-0.5 list-disc list-inside">
                            {invalidRows.map((r, i) => (
                              <li key={`${i}-${r.rowNum}`}>
                                <span className="font-medium">
                                  Row {r.rowNum}
                                  {r.patientName ? ` (${r.patientName})` : ''}:
                                </span>{' '}
                                {r.errors.join(' · ')}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* All clear */}
                      {validRows.length > 0 &&
                        missingPatientRows.length === 0 &&
                        invalidRows.length === 0 && (
                          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-700 text-sm">
                            <CheckCircle2 className="h-4 w-4" />
                            All {validRows.length} rows validated successfully. Ready to import.
                          </div>
                        )}
                    </div>
                  )
                })()}

              {/* ── Import Result ── */}
              {pmtImportResult &&
                (pmtImportResult.message && !pmtImportResult.errors ? (
                  <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-700 text-sm">
                    <CheckCircle2 className="h-4 w-4" /> {pmtImportResult.message}
                  </div>
                ) : pmtImportResult.message && pmtImportResult.errors ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-700 text-sm">
                      <CheckCircle2 className="h-4 w-4" /> {pmtImportResult.message}
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                      <p className="text-amber-800 text-sm font-medium">Some rows had issues:</p>
                      <ul className="text-xs text-amber-800 space-y-0.5 list-disc list-inside">
                        {pmtImportResult.errors.map((e, i) => (
                          <li key={`${i}-${e}`}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                    <div className="flex items-center gap-2 text-destructive text-sm font-medium">
                      <AlertCircle className="h-4 w-4" /> Import failed — fix errors and retry
                    </div>
                    <ul className="text-xs text-destructive space-y-0.5 list-disc list-inside">
                      {pmtImportResult.errors?.map((e, i) => (
                        <li key={`${i}-${e}`}>{e}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Recent Adjustments */}
      <RecentAdjustmentsTable
        adjustments={adjustments}
        patients={patients}
        loading={adjustmentsLoading}
      />
    </div>
  )
}
