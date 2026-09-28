import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { SonnerToaster } from '@/components/sonner-toaster'
import { AppErrorBoundary } from './components/app-error-boundary'
import { SectionGate } from './components/section-gate'

// Layouts
import DashboardLayout from './layouts/DashboardLayout'
// Analytics
import AnalyticsPage from './pages/analytics/index'
// Reports (financial statements)
import ApAgingReportPage from './pages/ap-aging/index'
// Clinical
import AppointmentsPage from './pages/appointments/index'
// Settings
import AuditLogsPage from './pages/audit-logs/index'
// Auth pages
import ForgotPasswordPage from './pages/auth/forgot-password/index'
import LoginPage from './pages/auth/login/index'
import ResetPasswordPage from './pages/auth/reset-password/index'
import BalanceSheetPage from './pages/balance-sheet/index'
import CashFlowPage from './pages/cash-flow/index'
import CashPositionPage from './pages/cash-position/index'
// Overview
import DashboardPage from './pages/dashboard/index'
import DeferredRevenueReportPage from './pages/deferred-revenue/index'
import DiscountsReportPage from './pages/discounts/index'
import ExpenseDetailPage from './pages/expenses/expense-detail'
import ExpensesPage from './pages/expenses/index'
import ExpenseWeeksPage from './pages/expenses/month'
import ExpenseWeekDetailPage from './pages/expenses/week'
import ExpenseMonthsPage from './pages/expenses/year'
// Finance
import FinancePage from './pages/finance/index'
import FinancialRecordsPage from './pages/financial-records/index'
// Patient Records
import MedicalRecordDetailPage from './pages/medical-records/detail'
import MedicalRecordsPage from './pages/medical-records/index'
import OrthoConsentDetailPage from './pages/ortho-consent/detail'
import OrthoConsentPage from './pages/ortho-consent/index'
import PatientDetailPage from './pages/patients/detail'
import PatientsPage from './pages/patients/index'
import PaymentPlanDetailPage from './pages/payment-plans/detail'
import PaymentsPage from './pages/payments/index'
import PayrollRunDetailPage from './pages/payroll/detail'
import PayrollPage from './pages/payroll/index'
import ProfitLossPage from './pages/profit-loss/index'
import ReportsPage from './pages/reports/index'
import RevenueByCategoryPage from './pages/revenue-by-category/index'
import RevenueByProviderPage from './pages/revenue-by-provider/index'
import SettingsPage from './pages/settings/index'
import SpecialistCommissionsReportPage from './pages/specialist-commissions/index'
import TaxCalculationsPage from './pages/tax-calculations/index'
import UsersPage from './pages/users/index'

export function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Root → Overview */}
          <Route path="/" element={<Navigate to="/overview" replace />} />

          {/* Backward-compat redirects for old paths */}
          <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
          <Route path="/patients" element={<Navigate to="/patient-records" replace />} />
          <Route path="/appointments" element={<Navigate to="/clinical" replace />} />
          <Route path="/payments" element={<Navigate to="/finance" replace />} />
          <Route path="/login" element={<Navigate to="/auth/login" replace />} />

          {/* Auth Routes */}
          <Route path="/auth/login" element={<LoginPage />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/reset-password" element={<ResetPasswordPage />} />

          {/* Protected Routes */}
          <Route
            element={
              <DashboardLayout>
                <Outlet />
              </DashboardLayout>
            }
          >
            {/* ── Overview ── */}
            <Route element={<SectionGate section="overview" />}>
              <Route path="/overview" element={<DashboardPage />} />
            </Route>

            {/* ── Patient Records ── static sub-paths before dynamic /:id ── */}
            <Route element={<SectionGate section="patient_records" />}>
              <Route path="/patient-records" element={<PatientsPage />} />
              <Route path="/patient-records/medical-records" element={<MedicalRecordsPage />} />
              <Route
                path="/patient-records/medical-records/:id"
                element={<MedicalRecordDetailPage />}
              />
              <Route path="/patient-records/ortho-consent" element={<OrthoConsentPage />} />
              <Route
                path="/patient-records/ortho-consent/:patientId"
                element={<OrthoConsentDetailPage />}
              />
              <Route path="/patient-records/:id" element={<PatientDetailPage />} />
            </Route>

            {/* ── Clinical ── */}
            <Route element={<SectionGate section="clinical" />}>
              <Route path="/clinical" element={<AppointmentsPage />} />
            </Route>

            {/* ── Finance ── */}
            <Route element={<SectionGate section="finance" />}>
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/finance/payments" element={<PaymentsPage />} />
              <Route path="/finance/payment-plans/:id" element={<PaymentPlanDetailPage />} />
              <Route path="/finance/expenses" element={<ExpensesPage />} />
              {/* static sub-path before dynamic /:year */}
              <Route path="/finance/expenses/view/:id" element={<ExpenseDetailPage />} />
              <Route path="/finance/expenses/:year" element={<ExpenseMonthsPage />} />
              <Route path="/finance/expenses/:year/:month" element={<ExpenseWeeksPage />} />
              <Route
                path="/finance/expenses/:year/:month/:week"
                element={<ExpenseWeekDetailPage />}
              />
              <Route path="/finance/payroll" element={<PayrollPage />} />
              <Route path="/finance/payroll/:runId" element={<PayrollRunDetailPage />} />
            </Route>

            {/* ── Reports (financial statements) ── */}
            <Route element={<SectionGate section="reports" />}>
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/reports/profit-loss" element={<ProfitLossPage />} />
              <Route path="/reports/balance-sheet" element={<BalanceSheetPage />} />
              <Route path="/reports/cash-flow" element={<CashFlowPage />} />
              <Route path="/reports/cash-position" element={<CashPositionPage />} />
              <Route path="/reports/revenue-by-category" element={<RevenueByCategoryPage />} />
              <Route path="/reports/revenue-by-provider" element={<RevenueByProviderPage />} />
              <Route path="/reports/deferred-revenue" element={<DeferredRevenueReportPage />} />
              <Route path="/reports/ap-aging" element={<ApAgingReportPage />} />
              <Route path="/reports/discounts" element={<DiscountsReportPage />} />
              <Route
                path="/reports/specialist-commissions"
                element={<SpecialistCommissionsReportPage />}
              />
              <Route path="/reports/financial-records" element={<FinancialRecordsPage />} />
              <Route path="/reports/tax-calculations" element={<TaxCalculationsPage />} />
            </Route>

            {/* ── Analytics ── */}
            <Route element={<SectionGate section="analytics" />}>
              <Route path="/analytics" element={<AnalyticsPage />} />
            </Route>

            {/* ── Settings ── */}
            <Route element={<SectionGate section="settings" />}>
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/audit-logs" element={<AuditLogsPage />} />
              <Route path="/settings/users" element={<UsersPage />} />
            </Route>
          </Route>

          <Route
            path="*"
            element={
              <div className="p-8 text-center">
                <h1 className="text-2xl font-bold">404 — Page Not Found</h1>
              </div>
            }
          />
        </Routes>
        <SonnerToaster />
      </BrowserRouter>
    </AppErrorBoundary>
  )
}
