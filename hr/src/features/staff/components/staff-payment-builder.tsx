import defaultLogo from '@denel/assets/logo.png'
import defaultMark from '@denel/assets/logo-icon.svg'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@denel/ui'
import { type PayslipDocData, PayslipDocument, type PayslipLine } from '@denel/ui/blocks'
import { computeGhanaPayrollFromParts, type OvertimeTaxCategory } from '@denel/utils'
import { format } from 'date-fns'
import { Loader2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getPublicBranding, type PublicBranding } from '@/lib/actions/branding'
import {
  createSalaryComponent,
  deleteSalaryComponent,
  getTaxBrackets,
  listSalaryComponents,
  type SalaryComponent,
  type TaxBracketRow,
} from '@/lib/actions/payroll-components'

interface CreateForm {
  basicSalary: string
  allowances: string
  overtimes: string
  taxCategory: string
  paye: string
  ssnitEmployee: string
  ssnitEmployer: string
  overtimeTax: string
  loan: string
  otherDeductions: string
  otherDeductionsLabel: string
  grossPay: string
  netPay: string
}

const EMPTY_FORM: CreateForm = {
  basicSalary: '',
  allowances: '',
  overtimes: '',
  taxCategory: 'standard',
  paye: '',
  ssnitEmployee: '',
  ssnitEmployer: '',
  overtimeTax: '',
  loan: '',
  otherDeductions: '',
  otherDeductionsLabel: 'Other deductions',
  grossPay: '',
  netPay: '',
}

const SSNIT_EMPLOYEE_PERCENT_DEFAULT = 5.5
const SSNIT_EMPLOYER_PERCENT_DEFAULT = 13.0

function resolveLogos(branding: PublicBranding | null) {
  if (!branding) return { header: defaultLogo, watermark: defaultMark }
  return {
    header: branding.logoUrl || defaultLogo,
    watermark: branding.logoIconUrl || defaultMark,
  }
}

function resolveSsnitRates(brackets: TaxBracketRow[]) {
  const employeeRow = brackets.find((b) => b.isActive && b.taxType === 'ssnit_employee')
  const employerRow = brackets.find((b) => b.isActive && b.taxType === 'ssnit_employer')

  const employeeRate = employeeRow
    ? Number(employeeRow.ratePercent)
    : SSNIT_EMPLOYEE_PERCENT_DEFAULT
  const employerRate = employerRow
    ? Number(employerRow.ratePercent)
    : SSNIT_EMPLOYER_PERCENT_DEFAULT

  return { employee: employeeRate, employer: employerRate }
}

function derivePayroll(
  inputs: { basic: number; allowances: number; overtime: number; category: string },
  brackets: TaxBracketRow[]
) {
  const { employee: ssnitEeRate, employer: ssnitErRate } = resolveSsnitRates(brackets)

  const payeBrackets = brackets
    .filter((b) => b.isActive && b.taxType === 'paye')
    .map((b) => ({
      lowerBound: Number(b.lowerBoundMonthly),
      upperBound: b.upperBoundMonthly ? Number(b.upperBoundMonthly) : null,
      ratePercent: Number(b.ratePercent),
    }))

  return computeGhanaPayrollFromParts(
    {
      basic: inputs.basic,
      allowances: inputs.allowances,
      overtime: inputs.overtime,
      category: inputs.category as OvertimeTaxCategory,
    },
    payeBrackets,
    ssnitEeRate,
    ssnitErRate
  )
}

interface PayeBand {
  rate: number
  tax: number
  cumulative: number
}

function payeLines(bands: PayeBand[] | undefined, totalPaye: number): PayslipLine[] {
  if (!bands || bands.length === 0) {
    if (totalPaye > 0) return [{ description: 'PAYE Tax', deduction: totalPaye }]
    return []
  }
  return bands
    .filter((b) => b.tax > 0)
    .map((b) => ({
      description: `PAYE (@ ${b.rate}%)`,
      rate: b.rate,
      deduction: b.tax,
    }))
}

function overtimeLines(bands: PayeBand[] | undefined, totalTax: number): PayslipLine[] {
  if (!bands || bands.length === 0) {
    if (totalTax > 0) return [{ description: 'Overtime Tax (QJE)', deduction: totalTax }]
    return []
  }
  return bands
    .filter((b) => b.tax > 0)
    .map((b) => ({
      description: `Overtime Tax (QJE @ ${b.rate}%)`,
      rate: b.rate,
      deduction: b.tax,
    }))
}

/** Minimum shape required by StaffPaymentBuilder. */
interface StaffRecord {
  fullName: string
  staffId: string
  employeeCategory: string | null
}

export function StaffPaymentBuilder({
  staffId,
  staff,
  onSaved,
}: {
  staffId: string
  staff: StaffRecord
  onSaved?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM)
  const [brackets, setBrackets] = useState<TaxBracketRow[]>([])
  const [branding, setBranding] = useState<PublicBranding | null>(null)
  const [existingComponents, setExistingComponents] = useState<SalaryComponent[]>([])

  useEffect(() => {
    getPublicBranding().then((res) => {
      if (res.success && res.data) setBranding(res.data)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const year = new Date().getFullYear()
    getTaxBrackets(year).then((res) => {
      if (res.success && res.data?.rows) {
        setBrackets(res.data.rows)
      } else {
        setBrackets([])
      }
    })
  }, [open])

  const recalculateNet = useCallback((currentForm: CreateForm): string => {
    const gross = Number(currentForm.grossPay) || 0
    const paye = Number(currentForm.paye) || 0
    const ssnitEe = Number(currentForm.ssnitEmployee) || 0
    const overtimeTax = Number(currentForm.overtimeTax) || 0
    const loan = Number(currentForm.loan) || 0
    const other = Number(currentForm.otherDeductions) || 0
    const net = Math.max(0, gross - paye - ssnitEe - overtimeTax - loan - other)
    return net > 0 ? net.toFixed(2) : ''
  }, [])

  const updateFormField = useCallback(
    (field: keyof CreateForm, value: string) => {
      setForm((f) => {
        const updated = { ...f, [field]: value }

        if (
          field === 'basicSalary' ||
          field === 'allowances' ||
          field === 'overtimes' ||
          field === 'taxCategory'
        ) {
          const calc = derivePayroll(
            {
              basic: Number(updated.basicSalary) || 0,
              allowances: Number(updated.allowances) || 0,
              overtime: Number(updated.overtimes) || 0,
              category: updated.taxCategory,
            },
            brackets
          )
          updated.grossPay = calc.gross > 0 ? calc.gross.toFixed(2) : ''
          updated.paye = calc.paye > 0 ? String(calc.paye) : ''
          updated.ssnitEmployee = calc.ssnitEmployee > 0 ? String(calc.ssnitEmployee) : ''
          updated.ssnitEmployer = calc.ssnitEmployer > 0 ? String(calc.ssnitEmployer) : ''
          updated.overtimeTax = calc.overtimeTax > 0 ? String(calc.overtimeTax) : ''
        }

        updated.netPay = recalculateNet(updated)
        return updated
      })
    },
    [brackets, recalculateNet]
  )

  const handleOpen = useCallback(async () => {
    setLoading(true)
    setOpen(true)
    setForm(EMPTY_FORM)
    setExistingComponents([])

    try {
      const [compRes] = await Promise.all([listSalaryComponents(staffId)])
      const components = compRes.success && compRes.data ? compRes.data : []
      setExistingComponents(components)

      const basic = components
        .filter((c) => c.type === 'basic')
        .reduce((sum, c) => sum + Number(c.amount), 0)
      const allowance = components
        .filter((c) => c.type === 'allowance')
        .reduce((sum, c) => sum + Number(c.amount), 0)
      const overtime = components
        .filter((c) => c.type === 'overtime')
        .reduce((sum, c) => sum + Number(c.amount), 0)
      const loanRows = components.filter(
        (c) => c.type === 'deduction' && c.name.toLowerCase().includes('loan')
      )
      const loan = loanRows.reduce((sum, c) => sum + Number(c.amount), 0)
      const otherRows = components.filter(
        (c) => c.type === 'deduction' && !c.name.toLowerCase().includes('loan')
      )
      const other = otherRows.reduce((sum, c) => sum + Number(c.amount), 0)
      const otherLabel = otherRows[0]?.name || 'Other deductions'

      const initialForm: CreateForm = {
        ...EMPTY_FORM,
        basicSalary: basic > 0 ? String(basic) : '',
        allowances: allowance > 0 ? String(allowance) : '',
        overtimes: overtime > 0 ? String(overtime) : '',
        loan: loan > 0 ? String(loan) : '',
        otherDeductions: other > 0 ? String(other) : '',
        otherDeductionsLabel: otherLabel,
        taxCategory: staff?.employeeCategory || 'standard',
      }

      setForm(initialForm)
    } catch {
      toast.error('Failed to load compensation profile')
    } finally {
      setLoading(false)
    }
  }, [staffId, staff?.employeeCategory])

  // Recalculate once the tax brackets are loaded so the preview is populated.
  useEffect(() => {
    if (open && brackets.length > 0) {
      updateFormField('basicSalary', form.basicSalary)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brackets, updateFormField, form.basicSalary])

  const previewData = useMemo<PayslipDocData>(() => {
    const logos = resolveLogos(branding)
    const lines: PayslipLine[] = []

    const earnRows: Array<[string, number]> = [
      ['Basic Salary', Number(form.basicSalary) || 0],
      ['Allowances', Number(form.allowances) || 0],
      ['Overtime', Number(form.overtimes) || 0],
    ]
    for (const [description, payment] of earnRows) {
      if (payment > 0) lines.push({ description, payment })
    }

    const calc = derivePayroll(
      {
        basic: Number(form.basicSalary) || 0,
        allowances: Number(form.allowances) || 0,
        overtime: Number(form.overtimes) || 0,
        category: form.taxCategory,
      },
      brackets
    )

    const paye = Number(form.paye) || 0
    lines.push(
      ...payeLines(
        calc.payeBands.map((b) => ({ rate: b.ratePercent, tax: b.tax, cumulative: 0 })),
        paye
      )
    )

    const ssnitEe = Number(form.ssnitEmployee) || 0
    if (ssnitEe > 0) {
      lines.push({ description: 'SSNIT (Employee)', rate: 5.5, deduction: ssnitEe })
    }

    const overtimeTax = Number(form.overtimeTax) || 0
    lines.push(
      ...overtimeLines(
        calc.overtimeBands.map((b) => ({ rate: b.ratePercent, tax: b.tax, cumulative: 0 })),
        overtimeTax
      )
    )

    const loan = Number(form.loan) || 0
    if (loan > 0) lines.push({ description: 'Loan Repayment', deduction: loan })

    const other = Number(form.otherDeductions) || 0
    if (other > 0) {
      lines.push({
        description: form.otherDeductionsLabel || 'Other deductions',
        deduction: other,
      })
    }

    const grossTotal = Number(form.grossPay) || lines.reduce((s, l) => s + (l.payment ?? 0), 0)
    const netDeductions = lines.reduce((s, l) => s + (l.deduction ?? 0), 0)
    const netTotal = Number(form.netPay) || Math.max(0, grossTotal - netDeductions)

    return {
      clinic: {
        name: branding?.name ?? 'Denel Dental Clinic',
        logoUrl: logos.header,
        logoIconUrl: logos.watermark,
        address: branding?.address ?? null,
        phone: branding?.phones?.[0] ?? null,
        email: branding?.email ?? null,
      },
      staff: {
        name: staff?.fullName ?? 'Staff Member',
        staffCode: staff?.staffId ?? null,
      },
      periodLabel: 'PREVIEW',
      lineDateLabel: 'PREVIEW',
      generatedLabel: format(new Date(), 'dd MMM yyyy'),
      status: 'draft',
      lines,
      grossTotal,
      netDeductions,
      netTotal,
      employerSsnit: Number(form.ssnitEmployer) || 0,
    }
  }, [form, staff, branding, brackets])

  async function handleSave() {
    setSaving(true)
    try {
      const basicAmount = Number(form.basicSalary) || 0
      const allowanceAmount = Number(form.allowances) || 0
      const overtimeAmount = Number(form.overtimes) || 0
      const loanAmount = Number(form.loan) || 0
      const otherAmount = Number(form.otherDeductions) || 0

      const effectiveFrom = new Date().toISOString().slice(0, 10)

      const deletable = existingComponents.filter((c) =>
        ['basic', 'allowance', 'deduction', 'overtime'].includes(c.type)
      )

      const deleteResults = await Promise.all(deletable.map((c) => deleteSalaryComponent(c.id)))
      const deleteError = deleteResults.find((r) => !r.success)
      if (deleteError) {
        toast.error(deleteError.error || 'Failed to remove existing components')
        return
      }

      const newComponents: Array<{
        type: SalaryComponent['type']
        name: string
        amount: number
        taxable: boolean
      }> = []
      if (basicAmount > 0) {
        newComponents.push({
          type: 'basic',
          name: 'Basic Salary',
          amount: basicAmount,
          taxable: true,
        })
      }
      if (allowanceAmount > 0) {
        newComponents.push({
          type: 'allowance',
          name: 'Allowances',
          amount: allowanceAmount,
          taxable: true,
        })
      }
      if (overtimeAmount > 0) {
        newComponents.push({
          type: 'overtime',
          name: 'Overtime',
          amount: overtimeAmount,
          taxable: true,
        })
      }
      if (loanAmount > 0) {
        newComponents.push({
          type: 'deduction',
          name: 'Loan Repayment',
          amount: loanAmount,
          taxable: false,
        })
      }
      if (otherAmount > 0) {
        newComponents.push({
          type: 'deduction',
          name: form.otherDeductionsLabel || 'Other deductions',
          amount: otherAmount,
          taxable: false,
        })
      }

      const createResults = await Promise.all(
        newComponents.map((c) =>
          createSalaryComponent(staffId, {
            ...c,
            currency: 'GHS',
            effectiveFrom,
          })
        )
      )
      const createError = createResults.find((r) => !r.success)
      if (createError) {
        toast.error(createError.error || 'Failed to save some components')
        return
      }

      toast.success('Compensation profile updated successfully.')
      setOpen(false)
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save compensation profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button onClick={handleOpen} variant="outline" className="w-full sm:w-auto">
        <Wrench className="mr-2 h-4 w-4" />
        Payment Profile Builder
      </Button>

      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen)
          if (!isOpen) setForm(EMPTY_FORM)
        }}
      >
        <DialogContent className="flex h-[85vh] max-h-[900px] w-[96vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle>Payment Profile Builder</DialogTitle>
            <DialogDescription>
              Set the permanent salary, allowances, and tax treatment for {staff?.fullName}. The
              preview computes live taxes for a standard month.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(360px,400px)_1fr]">
            {/* ── Inputs ─────────────────────────────────────────────────── */}
            <div className="min-h-0 space-y-4 overflow-y-auto border-r p-6">
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Earnings
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    id="ps-basic"
                    label="Basic Salary"
                    value={form.basicSalary}
                    onChange={(v) => updateFormField('basicSalary', v)}
                  />
                  <Field
                    id="ps-allowances"
                    label="Allowances"
                    value={form.allowances}
                    onChange={(v) => updateFormField('allowances', v)}
                  />
                  <Field
                    id="ps-overtime"
                    label="Overtime"
                    value={form.overtimes}
                    onChange={(v) => updateFormField('overtimes', v)}
                  />
                  <Field id="ps-gross" label="Gross pay" value={form.grossPay} disabled />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ps-ot-category">Overtime tax treatment</Label>
                  <select
                    id="ps-ot-category"
                    value={form.taxCategory}
                    onChange={(e) => updateFormField('taxCategory', e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="standard">Standard — overtime taxed as income (PAYE)</option>
                    <option value="qje">QJE — junior-staff concession (5% / 10%)</option>
                  </select>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {form.taxCategory === 'qje'
                      ? `Overtime up to 50% of basic is taxed at 5%, the excess at 10% — a final tax, kept out of PAYE.`
                      : 'Overtime is added to basic + allowances and taxed at the graduated PAYE rates.'}
                  </p>
                </div>
              </div>

              <div className="border-t pt-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Deductions (Computed)
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field id="ps-paye" label="PAYE Tax" value={form.paye} disabled />
                  <Field
                    id="ps-overtime-tax"
                    label="Overtime Tax (QJE)"
                    value={form.overtimeTax}
                    disabled={form.taxCategory !== 'qje'}
                  />
                  <Field
                    id="ps-ssnit-ee"
                    label="SSNIT Employee (5.5%)"
                    value={form.ssnitEmployee}
                    disabled
                  />
                  <Field
                    id="ps-ssnit-er"
                    label="SSNIT Employer (13%)"
                    value={form.ssnitEmployer}
                    disabled
                  />
                  <Field
                    id="ps-loan"
                    label="Loan Repayment"
                    value={form.loan}
                    onChange={(v) => updateFormField('loan', v)}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="ps-other-lbl">Other label</Label>
                    <Input
                      id="ps-other-lbl"
                      type="text"
                      placeholder="Other deductions"
                      value={form.otherDeductionsLabel}
                      onChange={(e) => updateFormField('otherDeductionsLabel', e.target.value)}
                    />
                  </div>
                  <Field
                    id="ps-other-amt"
                    label="Other amount"
                    value={form.otherDeductions}
                    onChange={(v) => updateFormField('otherDeductions', v)}
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <Field id="ps-net" label="Net pay" value={form.netPay} disabled />
              </div>
            </div>

            {/* ── Live preview ───────────────────────────────────────────── */}
            <div className="min-h-0 overflow-y-auto bg-slate-100 p-6 dark:bg-slate-900">
              {loading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <PayslipDocument data={previewData} />
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 border-t px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Compensation Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange?: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min="0"
        step="0.01"
        placeholder="0.00"
        value={value}
        disabled={disabled}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={disabled ? 'bg-muted text-muted-foreground cursor-not-allowed' : undefined}
      />
    </div>
  )
}
