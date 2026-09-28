import { useNavigate } from 'react-router-dom'
import { DataTable } from '@/components/data-table/data-table'
import { columns, type Expense } from './columns'

interface ExpensesClientProps {
  expenses: Expense[]
}

export function ExpensesClient({ expenses }: ExpensesClientProps) {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground">View clinic operational expenses.</p>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={expenses}
        initialColumnVisibility={{
          description: false,
        }}
        meta={{
          onRowClick: (expense: Expense) => {
            navigate(`/finance/expenses/view/${expense.id}`)
          },
        }}
      />
    </div>
  )
}
