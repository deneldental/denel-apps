import { format } from 'date-fns'
import {
  ArrowRight,
  Calendar,
  CalendarPlus,
  CreditCard,
  DollarSign,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  Package,
  TrendingDown,
  UserPlus,
} from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AddAppointmentSheet } from '@/features/appointments/components/add-appointment-sheet'
import { ActionItemsCard } from '@/features/dashboard/components/action-items-card'
import { ReportDetailSheet } from '@/features/dashboard/components/report-detail-sheet'
import type {
  ActionItemsData,
  AdminStats,
  AlertsPayload,
  DashboardPeriod,
  LowStockItem,
  OverduePaymentPlan,
  RecentReport,
} from '@/features/dashboard/types'
import { ReceiveStockSheet } from '@/features/inventory/components/receive-stock-sheet'
import { AddPatientSheet } from '@/features/patients/components/add-patient-sheet'
import { AcceptPaymentSheet } from '@/features/payments/components/accept-payment-sheet'
import { AddReportSheet } from '@/features/reports/components/add-report-sheet'
import { authClient } from '@/lib/auth-client'
import { useCan } from '@/lib/permissions-context'
import { Badge } from '@/shared/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { formatCompactCurrency, formatCompactNumber, formatCurrency } from '@/shared/utils/currency'

const SHOW_MONEY_STORAGE_KEY = 'denel.dashboard.showMoney'

type DashboardContentProps = {
  stats: AdminStats
  overduePayments: OverduePaymentPlan[]
  recentReports: RecentReport[]
  lowStockItems: LowStockItem[]
  birthdaysAndFollowups: AlertsPayload
  period?: DashboardPeriod
  hidePeriodSwitcher?: boolean
  actionItems: ActionItemsData
  onReloadActionItems: () => void | Promise<void>
  onReload: () => void
}

export function DashboardContent({
  stats,
  recentReports,
  lowStockItems,
  birthdaysAndFollowups,
  overduePayments,
  period = 'month',
  hidePeriodSwitcher = false,
  actionItems,
  onReloadActionItems,
  onReload,
}: DashboardContentProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [showMoney, setShowMoney] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SHOW_MONEY_STORAGE_KEY) === '1'
  })
  const [firstName, setFirstName] = useState('')
  const [submittedBy, setSubmittedBy] = useState('Unknown User')
  const [restockItem, setRestockItem] = useState<LowStockItem | null>(null)
  const [restockOpen, setRestockOpen] = useState(false)
  const [reportDetail, setReportDetail] = useState<RecentReport | null>(null)
  const [reportDetailOpen, setReportDetailOpen] = useState(false)

  // Quick-action gating — each mirrors the permission its API call requires, so
  // a shortcut is never offered for something the backend would reject. Admins
  // pass every check; custom roles only see what their bundles actually grant.
  const canAddPatient = useCan('patients', 'create')
  const canAcceptPayment = useCan('payments', 'create')
  const canScheduleAppointment = useCan('appointments', 'create')
  const canSubmitReport = useCan('reports', 'create')

  // §1.4 — quick-action open states (reuse existing create sheets/dialogs)
  const [acceptPaymentOpen, setAcceptPaymentOpen] = useState(false)
  const [appointmentOpen, setAppointmentOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SHOW_MONEY_STORAGE_KEY, showMoney ? '1' : '0')
  }, [showMoney])

  useEffect(() => {
    let cancelled = false
    authClient.getSession().then(({ data }) => {
      if (cancelled) return
      const u = data?.user as { name?: string; email?: string } | undefined
      setFirstName(u?.name?.split(' ')[0] ?? '')
      setSubmittedBy(u?.name || u?.email || 'Unknown User')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handlePeriodChange = (newPeriod: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('period', newPeriod)
    startTransition(() => {
      navigate(`?${params.toString()}`)
    })
  }

  const getPeriodLabel = () => {
    switch (period) {
      case 'day':
        return 'Today'
      case 'week':
        return 'Last 7 days'
      default:
        return 'Last 30 days'
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Top row: Welcome (left) + Stats cards (right 2×2) */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Welcome card */}
        <div className="rounded-2xl border bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/40 dark:to-background p-5 flex flex-col justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome back{firstName ? `, ${firstName}` : ''} <span aria-hidden>👋</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Here&apos;s the latest update — {getPeriodLabel().toLowerCase()}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={showMoney ? 'Hide money amounts' : 'Show money amounts'}
              title={showMoney ? 'Hide money amounts' : 'Show money amounts'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={() => setShowMoney((s) => !s)}
            >
              {showMoney ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
            {hidePeriodSwitcher ? (
              <span className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm font-medium text-muted-foreground">
                Today
              </span>
            ) : (
              <Select value={period} onValueChange={handlePeriodChange} disabled={isPending}>
                <SelectTrigger className="w-[160px] shrink-0 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Today</SelectItem>
                  <SelectItem value="week">Last 7 Days</SelectItem>
                  <SelectItem value="month">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Stats cards — 2×2 grid on the right */}
        <div className="grid grid-cols-2 gap-4">
          {/* New Patients — blue */}
          <div className="rounded-xl bg-gradient-to-br from-blue-100/70 to-blue-50/40 dark:from-blue-900/30 dark:to-blue-800/10 p-5 flex items-start justify-between border border-blue-200/60 dark:border-blue-800/40">
            <div className="space-y-2">
              <p className="text-sm font-medium text-blue-700 dark:text-blue-400">New Patients</p>
              <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">
                {formatCompactNumber(stats.totalPatients)}
              </p>
              <p className="text-xs font-medium text-blue-800 dark:text-blue-300">
                {getPeriodLabel()}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
                <UserPlus className="h-5 w-5" />
              </div>
            </div>
          </div>

          {/* Total Revenue — green */}
          <div className="rounded-xl bg-gradient-to-br from-green-100/70 to-green-50/40 dark:from-green-900/30 dark:to-green-800/10 p-5 flex items-start justify-between border border-green-200/60 dark:border-green-800/40">
            <div className="space-y-2">
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                Total Revenue
              </p>
              <p className="text-3xl font-bold text-green-900 dark:text-green-100">
                {showMoney ? formatCompactCurrency(stats.totalRevenue) : '••••'}
              </p>
              <p className="text-xs font-medium text-green-800 dark:text-green-300">
                {getPeriodLabel()}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-700 text-white shadow-sm shrink-0">
              <DollarSign className="h-5 w-5" />
            </div>
          </div>

          {/* Total Expenses — orange */}
          <div className="rounded-xl bg-gradient-to-br from-orange-100/70 to-orange-50/40 dark:from-orange-900/30 dark:to-orange-800/10 p-5 flex items-start justify-between border border-orange-200/60 dark:border-orange-800/40">
            <div className="space-y-2">
              <p className="text-sm font-medium text-orange-700 dark:text-orange-400">
                Total Expenses
              </p>
              <p className="text-3xl font-bold text-orange-900 dark:text-orange-100">
                {showMoney ? formatCompactCurrency(stats.totalExpenses) : '••••'}
              </p>
              <p className="text-xs font-medium text-orange-800 dark:text-orange-300">
                {getPeriodLabel()}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-700 text-white shadow-sm shrink-0">
              <TrendingDown className="h-5 w-5" />
            </div>
          </div>

          {/* Checked-in vs Booked — purple */}
          <div className="rounded-xl bg-gradient-to-br from-purple-100/70 to-purple-50/40 dark:from-purple-900/30 dark:to-purple-800/10 p-5 flex items-start justify-between border border-purple-200/60 dark:border-purple-800/40">
            <div className="space-y-2">
              <p className="text-sm font-medium text-purple-700 dark:text-purple-400">
                Checked-in / Booked
              </p>
              <p className="text-3xl font-bold text-purple-900 dark:text-purple-100">
                {stats.checkedIn} <span className="text-xl text-purple-500">/ {stats.booked}</span>
              </p>
              <p className="text-xs font-medium text-purple-800 dark:text-purple-300">
                {getPeriodLabel()}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-700 text-white shadow-sm shrink-0">
              <Calendar className="h-5 w-5" />
            </div>
          </div>
        </div>
      </div>
      {/* end top row */}

      {/* §1.4 — Quick actions: 2×2 grid, each gated on its own permission */}
      {(canAddPatient || canAcceptPayment || canScheduleAppointment || canSubmitReport) && (
        <div className="grid grid-cols-2 gap-3">
          {canAddPatient && (
            <AddPatientSheet
              onCreated={onReload}
              trigger={
                <button
                  type="button"
                  className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl border bg-background px-4 text-base font-semibold hover:bg-accent transition-colors"
                >
                  <UserPlus className="h-5 w-5" />
                  Add Patient
                </button>
              }
            />
          )}
          {canAcceptPayment && (
            <button
              type="button"
              onClick={() => setAcceptPaymentOpen(true)}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border bg-background px-4 text-base font-semibold hover:bg-accent transition-colors"
            >
              <CreditCard className="h-5 w-5" />
              Accept payment
            </button>
          )}
          {canScheduleAppointment && (
            <AddAppointmentSheet
              open={appointmentOpen}
              onOpenChange={setAppointmentOpen}
              onCreated={onReload}
              trigger={
                <button
                  type="button"
                  className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl border bg-background px-4 text-base font-semibold hover:bg-accent transition-colors"
                >
                  <CalendarPlus className="h-5 w-5" />
                  Schedule appointment
                </button>
              }
            />
          )}
          {canSubmitReport && (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border bg-background px-4 text-base font-semibold hover:bg-accent transition-colors"
            >
              <FilePlus2 className="h-5 w-5" />
              Submit daily report
            </button>
          )}
        </div>
      )}

      {/* Activities — aggregated admin view (overdue payments + birthdays surfaced as tabs) */}
      <ActionItemsCard
        isAdminView
        overduePayments={overduePayments}
        birthdaysAndFollowups={birthdaysAndFollowups}
        data={actionItems}
        loading={false}
        onReload={onReloadActionItems}
      />

      {/* Sheets */}
      <ReceiveStockSheet
        defaultItemId={restockItem?.id}
        open={restockOpen}
        onOpenChange={setRestockOpen}
        onSaved={onReload}
      />
      <ReportDetailSheet
        report={reportDetail}
        open={reportDetailOpen}
        onOpenChange={setReportDetailOpen}
      />

      {/* §1.4 quick-action dialogs/sheets */}
      <AcceptPaymentSheet
        open={acceptPaymentOpen}
        onOpenChange={setAcceptPaymentOpen}
        onSuccess={onReload}
      />
      <AddReportSheet
        open={reportOpen}
        onOpenChange={setReportOpen}
        submittedBy={submittedBy}
        onSuccess={onReload}
      />

      {/* Two-column row: Recent Reports + Low Stock Alert */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Recent Reports */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Recent Reports
                </CardTitle>
                <CardDescription>
                  Last {recentReports.length} daily reports submitted
                </CardDescription>
              </div>
              <Link
                to="/reports"
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                View all
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentReports.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No reports submitted yet
              </div>
            ) : (
              <div className="space-y-4">
                {recentReports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    className="w-full flex items-center justify-between rounded-lg border p-3 hover:bg-accent transition-colors text-left"
                    onClick={() => {
                      setReportDetail(report)
                      setReportDetailOpen(true)
                    }}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        {format(new Date(report.reportDate), 'MMM dd, yyyy')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        By {report.submittedBy?.name || report.submittedBy?.email || 'Unknown'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-green-600">
                        {formatCurrency(report.totalPayments)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {report.checkedInCount} patients
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Low Stock Inventory */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Low Stock Alert
                </CardTitle>
                <CardDescription>Items that need restocking</CardDescription>
              </div>
              <Link
                to="/inventory?tab=low-stock"
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                View all
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {lowStockItems.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                All items are well stocked
              </div>
            ) : (
              <div className="space-y-3">
                {lowStockItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="w-full flex items-center justify-between rounded-lg border p-3 hover:bg-accent transition-colors text-left"
                    onClick={() => {
                      setRestockItem(item)
                      setRestockOpen(true)
                    }}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{item.name}</p>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={item.stockQuantity === 0 ? 'destructive' : 'secondary'}
                          className="text-xs"
                        >
                          {item.type === 'inventory' ? 'Inventory' : 'Product'}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-sm font-semibold ${item.stockQuantity === 0 ? 'text-red-600' : 'text-orange-600'}`}
                      >
                        {item.stockQuantity} {item.unit || 'units'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Min: {item.reorderLevel ?? 'N/A'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
