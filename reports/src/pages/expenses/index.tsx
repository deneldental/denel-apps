import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getExpenses } from '@/lib/actions/expenses'
import { ExpensesClient } from './expenses-client'

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const result = await getExpenses()
        setExpenses(result.success ? (result.data ?? []) : [])
      } catch (error) {
        console.error('Failed to load expenses:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <ExpensesClient expenses={expenses} />
}
