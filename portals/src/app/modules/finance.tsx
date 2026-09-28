import { Wallet } from 'lucide-react'
import { Navigate, Route } from 'react-router-dom'
import ChartOfAccountsPage from '@/features/accounting/pages/chart-of-accounts'
import FinanceHealthPage from '@/features/accounting/pages/health'
import JournalPage from '@/features/accounting/pages/journal'
import PeriodsPage from '@/features/accounting/pages/periods'
import WhtCitPage from '@/features/accounting/pages/wht-cit'
import PaymentMethodsPage from '@/features/app-payments/pages/payment-methods'
import BillDetailPage from '@/features/bills/pages/bill-detail'
import BillsPage from '@/features/bills/pages/index'
import PaymentsLedgerPage from '@/features/clinic-ledger/pages/index'
import DeferredRevenuePage from '@/features/deferred-revenue/pages/index'
import ExpenseDetailPage from '@/features/expenses/pages/expense-detail'
import ExpensesPage from '@/features/expenses/pages/index'
import ExpenseWeeksPage from '@/features/expenses/pages/month'
import ExpenseWeekDetailPage from '@/features/expenses/pages/week'
import ExpenseMonthsPage from '@/features/expenses/pages/year'
import { FinanceLayout } from '@/features/finance/finance-layout'
import FinancePayrollPage from '@/features/finance/pages/payroll'
import PriceAdjustmentsPage from '@/features/finance/pages/price-adjustments'
import FinancialRecordsPage from '@/features/financial-records/pages/index'
import FixedAssetDetailPage from '@/features/fixed-assets/pages/detail'
import FixedAssetsPage from '@/features/fixed-assets/pages/index'
import InvoiceComposerPage from '@/features/invoices/pages/invoice-composer'
import PaymentPlanDetailPage from '@/features/payment-plans/pages/detail'
import RefundsPage from '@/features/payments/pages/refunds'
import PettyCashPage from '@/features/petty-cash/pages/index'
import TaxCalculationsPage from '@/features/tax-calculations/pages/index'
import TaxConfigurationPage from '@/features/tax-config/pages/index'
import { AdminRoute } from '@/shared/components/admin-route'
import type { Module } from './types'

export const financeModule: Module = {
  id: 'finance',
  label: 'Finance',
  order: 6.0,
  disallowedRoles: ['doctor'],
  hasAccess: (can) =>
    can('payments', 'read') && (can('expenses', 'read') || can('inventory', 'update')),
  routes: [
    // All finance routes render inside <FinanceLayout /> — which provides the
    // mini-sidebar. Routes stay at their original top-level paths so existing
    // bookmarks + audit-log URLs keep working (URL-prefix policy: accept
    // mismatch for Finance per plan P.5).
    <Route key="finance-layout" element={<FinanceLayout />}>
      <Route path="/payments" element={<PaymentsLedgerPage />} />
      {/* Patient-app payment methods config (what patients pay into) — admin only. */}
      <Route
        path="/finance/payment-methods"
        element={
          <AdminRoute>
            <PaymentMethodsPage />
          </AdminRoute>
        }
      />
      {/* Admin-only surcharge/discount anomaly monitoring (0215). */}
      <Route
        path="/finance/price-adjustments"
        element={
          <AdminRoute>
            <PriceAdjustmentsPage />
          </AdminRoute>
        }
      />
      {/* Redirect old clinic-ledger URL to the merged page. Rendered outside
          the layout isn't necessary — it's a transient redirect. */}
      <Route path="/clinic-ledger" element={<Navigate to="/payments" replace />} />
      <Route path="/payment-plans/:id" element={<PaymentPlanDetailPage />} />
      {/* Finance Payroll Disbursal Page */}
      <Route path="/finance/payroll" element={<FinancePayrollPage />} />
      <Route path="/expenses" element={<ExpensesPage />} />
      <Route path="/petty-cash" element={<PettyCashPage />} />
      <Route path="/expenses/view/:id" element={<ExpenseDetailPage />} />
      <Route path="/expenses/:year" element={<ExpenseMonthsPage />} />
      <Route path="/expenses/:year/:month" element={<ExpenseWeeksPage />} />
      <Route path="/expenses/:year/:month/:week" element={<ExpenseWeekDetailPage />} />
      <Route path="/financial-records" element={<FinancialRecordsPage />} />
      <Route
        path="/ledger-adjustments"
        element={<Navigate to="/settings?section=ledger-adjustments" replace />}
      />
      <Route path="/tax-calculations" element={<TaxCalculationsPage />} />
      <Route path="/finance/tax-configuration" element={<TaxConfigurationPage />} />
      {/* /aging-report moved into /analytics/financial?tab=aging — preserve the
          old URL with a redirect so bookmarks and audit-log links keep working. */}
      <Route
        path="/aging-report"
        element={<Navigate to="/analytics/financial?tab=aging" replace />}
      />
      <Route path="/accounting/chart-of-accounts" element={<ChartOfAccountsPage />} />
      <Route path="/accounting/journal" element={<JournalPage />} />
      <Route path="/accounting/periods" element={<PeriodsPage />} />
      <Route path="/accounting/health" element={<FinanceHealthPage />} />
      {/* §4.7 — WHT certificates + CIT installments (§4.5 tax obligations folded in) */}
      <Route path="/accounting/wht-cit" element={<WhtCitPage />} />
      <Route path="/invoices/:id" element={<InvoiceComposerPage />} />
      <Route path="/refunds" element={<RefundsPage />} />
      <Route path="/bills" element={<BillsPage />} />
      <Route path="/bills/new" element={<BillDetailPage />} />
      <Route path="/bills/:id" element={<BillDetailPage />} />
      <Route path="/deferred-revenue" element={<DeferredRevenuePage />} />
      {/* F6 — Fixed Asset Register (assets + depreciation schedules + prepaid). */}
      <Route path="/financials/assets" element={<FixedAssetsPage />} />
      <Route path="/financials/assets/:id" element={<FixedAssetDetailPage />} />
    </Route>,
  ],
  // Flat top-level entry only — the mini-sidebar inside FinanceLayout handles
  // the sub-navigation (Part 2 plan removes nested `children` from the main sidebar).
  navItems: [
    {
      label: 'Finance',
      to: '/payments',
      icon: Wallet,
    },
  ],
}
