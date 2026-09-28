import {
  BookOpen,
  Calculator,
  CalendarRange,
  Clock4,
  Coins,
  FileBox,
  FileText,
  HeartPulse,
  Landmark,
  Layers,
  Percent,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Users2,
  Wallet,
} from 'lucide-react'
import { type MiniSidebarItem, MiniSidebarLayout } from '@/shared/components/mini-sidebar-layout'

/**
 * Mini-sidebar nav for the Finance module. Wired into the router at the parent
 * `<Route element={<FinanceLayout />}>` level so every child route renders inside
 * this layout's `<Outlet />`.
 *
 * Keep items ordered by how frequently they're used day-to-day — top-of-list
 * is seen first, bottom-of-list is deep-ops.
 *
 * **Aging Report** moved to /analytics/financial (Aging Report tab).
 * **Specialists** moved to its own top-level module (sidebar entry after Services).
 */
const FINANCE_NAV: MiniSidebarItem[] = [
  { label: 'Payments & Ledger', to: '/payments', icon: Wallet, permission: 'payments' },
  {
    label: 'App Payment Methods',
    to: '/finance/payment-methods',
    icon: Smartphone,
    permission: 'payments',
    adminOnly: true,
  },
  { label: 'Credit Payouts', to: '/refunds', icon: RotateCcw, permission: 'payments' },
  {
    label: 'Price Adjustments',
    to: '/finance/price-adjustments',
    icon: TrendingUp,
    permission: 'financial_records',
    adminOnly: true,
  },
  { label: 'Expenses', to: '/expenses', icon: Receipt, permission: 'expenses' },
  { label: 'Petty Cash', to: '/petty-cash', icon: Coins, permission: 'expenses' },
  { label: 'AP Bills', to: '/bills', icon: FileBox, permission: 'financial_records' },
  {
    label: 'Statements',
    to: '/financial-records',
    icon: FileText,
    permission: 'financial_records',
  },
  {
    label: 'Tax Calculations',
    to: '/tax-calculations',
    icon: Calculator,
    permission: 'tax_calculations',
  },
  {
    label: 'Tax Configuration',
    to: '/finance/tax-configuration',
    icon: Percent,
    permission: 'settings',
  },
  {
    label: 'Chart of Accounts',
    to: '/accounting/chart-of-accounts',
    icon: Layers,
    permission: 'accounts',
  },
  { label: 'Journal', to: '/accounting/journal', icon: BookOpen, permission: 'journal_entries' },
  { label: 'Periods', to: '/accounting/periods', icon: CalendarRange, permission: 'periods' },
  {
    label: 'Reconciliation',
    to: '/accounting/health',
    icon: HeartPulse,
    permission: 'financial_records',
  },
  {
    label: 'Deferred Revenue',
    to: '/deferred-revenue',
    icon: Clock4,
    permission: 'financial_records',
  },
  { label: 'Asset Register', to: '/financials/assets', icon: Landmark, permission: 'accounts' },
  { label: 'WHT / CIT', to: '/accounting/wht-cit', icon: ShieldCheck, permission: 'accounts' },
  { label: 'Payroll', to: '/finance/payroll', icon: Users2, permission: 'financial_records' },
]

export function FinanceLayout() {
  return <MiniSidebarLayout title="Finance" items={FINANCE_NAV} />
}
