import defaultLogo from '@denel/assets/logo.png'
import defaultMark from '@denel/assets/logo-icon.svg'
import { type PayslipDocData, PayslipDocument, type PayslipLine } from '@denel/ui/blocks'
import { formatAmount } from '@denel/utils'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight, Download, FileText, Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { env } from '@/config/env'
import { api, staffApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const PAGE_SIZE = 12

type PayeBand = { rate?: number | string; taxable?: number | string; tax?: number | string }

type PayslipDeductions = {
  paye?: number | string
  paye_bands?: PayeBand[]
  ssnit_employee?: number | string
  ssnit_employer?: number | string
  overtime_tax?: number | string
  overtime_bands?: PayeBand[]
  loan?: number | string
  other?: Array<{ label?: string; amount?: number | string }>
} | null

type PayslipComponent = { name: string; type: string; amount: number }

interface Payslip {
  id: string
  payPeriod: string
  grossPay: string | null
  netPay: string | null
  fileUrl: string | null
  publishedAt: string | null
  status: string
  disbursedAt: string | null
  deductions?: PayslipDeductions
  components?: PayslipComponent[]
}

function formatGhs(amount: string | number | null | undefined): string {
  if (amount == null) return '—'
  return `GHS ${formatAmount(Number(amount))}`
}

/**
 * Tax deduction rows (PAYE or QJE overtime tax) — one per rate band when the
 * saved payslip carries a band breakdown, otherwise a single total row. Bands
 * are only broken out when they reconcile to the total (i.e. it wasn't manually
 * overridden). Renders nothing when the total is zero.
 */
function detailToDocData(slip: Payslip, user: any, branding: any): PayslipDocData {
  const ded = slip.deductions
  const earnings = (slip.components || []).filter((c) =>
    ['basic', 'allowance', 'bonus', 'overtime', 'reimbursement'].includes(c.type)
  )

  const lines: PayslipLine[] = []

  for (const e of earnings) {
    if (e.amount > 0) lines.push({ description: e.name, payment: e.amount })
  }

  if (ded?.paye_bands && ded.paye_bands.length > 0) {
    for (const b of ded.paye_bands) {
      if (Number(b.tax) > 0) {
        lines.push({
          description: `PAYE (@ ${b.rate}%)`,
          rate: Number(b.rate),
          deduction: Number(b.tax),
        })
      }
    }
  } else if (Number(ded?.paye) > 0) {
    lines.push({ description: 'PAYE Tax', deduction: Number(ded?.paye) })
  }

  if (Number(ded?.ssnit_employee) > 0) {
    lines.push({
      description: 'SSNIT (Employee)',
      rate: 5.5,
      deduction: Number(ded?.ssnit_employee),
    })
  }

  if (ded?.overtime_bands && ded.overtime_bands.length > 0) {
    for (const b of ded.overtime_bands) {
      if (Number(b.tax) > 0) {
        lines.push({
          description: `Overtime Tax (QJE @ ${b.rate}%)`,
          rate: Number(b.rate),
          deduction: Number(b.tax),
        })
      }
    }
  } else if (Number(ded?.overtime_tax) > 0) {
    lines.push({ description: 'Overtime Tax (QJE)', deduction: Number(ded?.overtime_tax) })
  }

  if (Number(ded?.loan) > 0) {
    lines.push({ description: 'Loan Repayment', deduction: Number(ded?.loan) })
  }

  if (ded?.other) {
    for (const o of ded.other) {
      if (Number(o.amount) > 0) {
        lines.push({ description: o.label || 'Other Deduction', deduction: Number(o.amount) })
      }
    }
  }

  const grossTotal = Number(slip.grossPay) || 0
  const netTotal = Number(slip.netPay) || 0
  const netDeductions = grossTotal - netTotal

  const month = slip.payPeriod ? format(new Date(`${slip.payPeriod}T00:00:00`), 'MMMM yyyy') : '—'

  return {
    clinic: {
      name: branding?.name || 'Denel Dental Clinic',
      logoUrl: branding?.logoUrl || defaultLogo,
      logoIconUrl: branding?.logoIconUrl || defaultMark,
      address: branding?.address || null,
      phone: branding?.phones?.[0] || null,
      email: branding?.email || null,
    },
    staff: {
      name: user?.fullName || 'Staff Member',
      staffCode: user?.staffId || null,
    },
    periodLabel: `${month} PAYSLIP`,
    lineDateLabel: month,
    generatedLabel: format(
      slip.publishedAt ? new Date(slip.publishedAt) : new Date(),
      'dd MMM yyyy'
    ),
    lines,
    grossTotal,
    netDeductions,
    netTotal,
    employerSsnit: Number(ded?.ssnit_employer) || 0,
    isUnpaid: slip.status !== 'suspended' && !slip.disbursedAt,
  }
}

function PayslipDetailDialog({
  payslip,
  user,
  branding,
  onClose,
}: {
  payslip: Payslip | null
  user: any
  branding: any
  onClose: () => void
}) {
  const [detail, setDetail] = useState<Payslip | null>(null)
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    if (!payslip) {
      setDetail(null)
      return
    }
    setDetail(payslip)
    setFetching(true)
    staffApi
      .getPayslip(payslip.id)
      .then((res) => {
        if (res.success && res.data) setDetail(res.data as Payslip)
      })
      .catch(() => {})
      .finally(() => setFetching(false))
  }, [payslip?.id])

  const slip = detail ?? payslip
  if (!slip) return null

  const downloadUrl = slip.fileUrl || `/api/staff-portal/payslips/${slip.id}/pdf`
  const fullDownloadUrl = downloadUrl.startsWith('/')
    ? `${env.VITE_API_URL}${downloadUrl}`
    : downloadUrl

  const docData = detailToDocData(slip, user, branding)

  return (
    <Dialog open={!!payslip} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[800px] w-[95vw] p-0 h-[90vh] flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-900">
        <DialogHeader className="sr-only">
          <DialogTitle>Payslip Detail</DialogTitle>
          <DialogDescription>Payslip document viewer</DialogDescription>
        </DialogHeader>

        {fetching && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 overflow-auto p-4 sm:p-6 pb-24">
          <div className="min-w-[700px] w-full">
            <PayslipDocument data={docData} />
          </div>
        </div>

        <div className="absolute bottom-6 right-6 z-20">
          <Button asChild className="shadow-lg">
            <a href={fullDownloadUrl} target="_blank" rel="noopener noreferrer" download>
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function PayslipsPage() {
  const { user } = useAuth()
  const [branding, setBranding] = useState<any>(null)
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<Payslip | null>(null)

  useEffect(() => {
    api.get('/api/integrations/branding/public').then((res) => {
      if (res.success && res.data) setBranding(res.data)
    })

    staffApi
      .getPayslips()
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setPayslips(res.data as Payslip[])
        } else {
          setError(res.error || 'Failed to load payslips')
        }
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false))
  }, [])

  // Sort latest first, then paginate, then group the visible page by year
  const sorted = useMemo(
    () => [...payslips].sort((a, b) => b.payPeriod.localeCompare(a.payPeriod)),
    [payslips]
  )
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageSlice = sorted.slice(pageStart, pageStart + PAGE_SIZE)

  const byYear = pageSlice.reduce<Record<string, Payslip[]>>((acc, slip) => {
    const year = slip.payPeriod.slice(0, 4)
    acc[year] = acc[year] ?? []
    acc[year].push(slip)
    return acc
  }, {})

  const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a))

  return (
    <div className="p-5 pb-8 space-y-5">
      <div className="pt-2">
        <h1 className="text-2xl font-bold tracking-tight">Payslips</h1>
        <p className="text-sm text-muted-foreground">Your published monthly payslips</p>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && payslips.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No payslips available yet.</p>
          </CardContent>
        </Card>
      )}

      {!loading &&
        years.map((year) => (
          <div key={year} className="space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {year}
            </h2>
            <Card>
              <CardContent className="p-0 divide-y divide-border">
                {byYear[year].map((slip) => {
                  const month = slip.payPeriod
                    ? format(new Date(`${slip.payPeriod}T00:00:00`), 'MMMM')
                    : '—'
                  return (
                    <div
                      key={slip.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetail(slip)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setDetail(slip)
                        }
                      }}
                      className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">
                          {month} {year}
                        </p>
                        <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground">
                          <span>Gross: {formatGhs(slip.grossPay)}</span>
                          <span>Net: {formatGhs(slip.netPay)}</span>
                        </div>
                      </div>
                      {slip.status === 'suspended' ? (
                        <Badge variant="destructive" className="text-[10px] ml-auto">
                          Suspended
                        </Badge>
                      ) : slip.disbursedAt ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] ml-auto bg-emerald-50 text-emerald-600 border-emerald-200"
                        >
                          Paid
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] ml-auto bg-amber-50 text-amber-600 border-amber-200"
                        >
                          Unpaid
                        </Badge>
                      )}
                      {slip.status !== 'suspended' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          asChild
                          className="text-muted-foreground hover:text-foreground ml-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <a
                            href={
                              (
                                slip.fileUrl || `/api/staff-portal/payslips/${slip.id}/pdf`
                              ).startsWith('/')
                                ? `${env.VITE_API_URL}${slip.fileUrl || `/api/staff-portal/payslips/${slip.id}/pdf`}`
                                : slip.fileUrl || `/api/staff-portal/payslips/${slip.id}/pdf`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Download size={16} />
                          </a>
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled
                          aria-label="Download"
                          className="ml-2"
                        >
                          <Download size={16} />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        ))}

      <PayslipDetailDialog
        payslip={detail}
        user={user}
        branding={branding}
        onClose={() => setDetail(null)}
      />

      {!loading && sorted.length > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-3">
          <span className="text-xs text-muted-foreground">
            {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="text-xs font-semibold px-2">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
