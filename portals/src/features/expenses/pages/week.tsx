import { useParams } from 'react-router-dom'
import { BreadcrumbNav } from '@/features/dashboard/components/breadcrumb-nav'
import { WeekExpensesTable } from '@/features/expenses/components/week-expenses-table'
import { columns, type Expense } from './columns'

const NULL_EXPENSE_FIELDS = {
  status: 'paid',
  accountId: null,
  paidAt: null,
  deferredReason: null,
  deferredById: null,
  linkedEntityType: null,
  linkedEntityId: null,
  createdById: null,
  pettyRefType: null,
  pettyRefId: null,
  pettyRefName: null,
  pettyRefContact: null,
  confirmationStatus: null,
  confirmedById: null,
  confirmedAt: null,
  confirmationNote: null,
  confirmationProofUrl: null,
} as const

// Placeholder data until backend week-expenses endpoint is wired up
const data: Expense[] = [
  {
    id: '728ed52f',
    category: 'office',
    amount: 10000,
    date: new Date('2023-01-01'),
    description: 'Office Supplies',
    paidTo: 'Supplier A',
    paymentMethod: 'cash',
    createdAt: new Date('2023-01-01'),
    attachmentUrl: null,
    dailyReportId: null,
    ...NULL_EXPENSE_FIELDS,
  },
  {
    id: '489e1d42',
    category: 'software',
    amount: 12500,
    date: new Date('2023-01-05'),
    description: 'Software License',
    paidTo: 'Tech Vendor',
    paymentMethod: 'card',
    createdAt: new Date('2023-01-05'),
    attachmentUrl: null,
    dailyReportId: null,
    ...NULL_EXPENSE_FIELDS,
  },
  {
    id: '629e1d42',
    category: 'equipment',
    amount: 45000,
    date: new Date('2023-01-10'),
    description: 'Equipment Maintenance',
    paidTo: 'Service Provider',
    paymentMethod: 'transfer',
    createdAt: new Date('2023-01-10'),
    attachmentUrl: null,
    dailyReportId: null,
    ...NULL_EXPENSE_FIELDS,
  },
  {
    id: '629e1d45',
    category: 'other',
    amount: 1500,
    date: new Date('2023-01-11'),
    description: 'Coffee',
    paidTo: null,
    paymentMethod: 'cash',
    createdAt: new Date('2023-01-11'),
    attachmentUrl: null,
    dailyReportId: null,
    ...NULL_EXPENSE_FIELDS,
  },
]

export default function WeekExpensesPage() {
  const { year, month, week } = useParams<{ year: string; month: string; week: string }>()
  const displayMonth = month ? month.charAt(0).toUpperCase() + month.slice(1) : ''

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbNav />
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">Week {week} Expenses</h1>
        <p className="text-muted-foreground">
          {displayMonth} {year}
        </p>
      </div>

      <div className="rounded-lg border border-dashed shadow-sm p-4 h-[600px] flex flex-col">
        <WeekExpensesTable columns={columns} data={data} />
      </div>
    </div>
  )
}
