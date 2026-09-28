import {
  BarChart2,
  BookOpen,
  Calendar,
  Clock,
  DollarSign,
  FileText,
  Percent,
  Scale,
  Tag,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const FINANCIAL_STATEMENTS = [
  {
    label: 'Profit & Loss',
    description: 'Revenue and expenses over a selected period.',
    href: '/reports/profit-loss',
    icon: TrendingUp,
  },
  {
    label: 'Balance Sheet',
    description: 'Assets, liabilities, and equity at a point in time.',
    href: '/reports/balance-sheet',
    icon: Scale,
  },
  {
    label: 'Cash Flow',
    description: 'Cash inflows and outflows from operations.',
    href: '/reports/cash-flow',
    icon: DollarSign,
  },
  {
    label: 'Cash Position',
    description: 'Current cash and liquidity summary.',
    href: '/reports/cash-position',
    icon: Wallet,
  },
  {
    label: 'Revenue by Category',
    description: 'Breakdown of income by service category.',
    href: '/reports/revenue-by-category',
    icon: BarChart2,
  },
  {
    label: 'Revenue by Provider',
    description: 'Income attributed to each specialist or doctor.',
    href: '/reports/revenue-by-provider',
    icon: Users,
  },
  {
    label: 'Deferred Revenue',
    description: 'Unearned revenue recognition schedule.',
    href: '/reports/deferred-revenue',
    icon: Clock,
  },
  {
    label: 'AP Aging',
    description: 'Accounts payable aging buckets by supplier.',
    href: '/reports/ap-aging',
    icon: Calendar,
  },
  {
    label: 'Discounts',
    description: 'Discount amounts, types, and authorization trail.',
    href: '/reports/discounts',
    icon: Percent,
  },
  {
    label: 'Specialist Commissions',
    description: 'Commission accruals and payouts per specialist.',
    href: '/reports/specialist-commissions',
    icon: Tag,
  },
  {
    label: 'Financial Records (GL)',
    description: 'General ledger journal entries and account balances.',
    href: '/reports/financial-records',
    icon: BookOpen,
  },
  {
    label: 'Tax Calculations',
    description: 'GRA tax breakdown per invoiced transaction.',
    href: '/reports/tax-calculations',
    icon: FileText,
  },
]

export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Financial statements and accounting reports.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FINANCIAL_STATEMENTS.map((statement) => (
          <Link key={statement.href} to={statement.href}>
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <div className="flex items-center gap-2 mb-1">
                  <statement.icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">{statement.label}</CardTitle>
                </div>
                <CardDescription>{statement.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
