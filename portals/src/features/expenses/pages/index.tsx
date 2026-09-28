import { useQuery } from '@tanstack/react-query'
import { getExpenses } from '@/lib/actions/expenses'
import { queryKeys } from '@/lib/query-keys'
import { ExpensesClient } from './expenses-client'

export default function ExpensesPage() {
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: queryKeys.expenses.list(),
    queryFn: async () => {
      const result = await getExpenses()
      return result.success ? (result.data ?? []) : []
    },
  })

  if (isLoading) return null

  return <ExpensesClient expenses={expenses} />
}
