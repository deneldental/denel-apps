import { CreditCard, DollarSign, Receipt, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const FINANCE_SECTIONS = [
  {
    label: 'Payments',
    description: 'Patient payments, receipts, and payment methods.',
    href: '/finance/payments',
    icon: CreditCard,
  },
  {
    label: 'Expenses',
    description: 'Clinic operational expenses by category and period.',
    href: '/finance/expenses',
    icon: Receipt,
  },
  {
    label: 'Payroll',
    description: 'Pay runs and payslip breakdown for all staff.',
    href: '/finance/payroll',
    icon: Wallet,
  },
]

export default function FinancePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <DollarSign className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">Finance</h1>
          <p className="text-sm text-muted-foreground">Payments, expenses, and payroll data.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FINANCE_SECTIONS.map((section) => (
          <Link key={section.href} to={section.href}>
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <div className="flex items-center gap-2 mb-1">
                  <section.icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">{section.label}</CardTitle>
                </div>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
