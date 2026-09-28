import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ExpenseDetailContent } from '@/components/expenses/expense-detail-content'
import { getExpense } from '@/lib/actions/expenses'

export default function ExpenseDetailPage() {
  const navigate = useNavigate()
  const params = useParams()
  const id = params.id as string
  const [loading, setLoading] = useState(true)
  const [expense, setExpense] = useState<any>(null)

  useEffect(() => {
    async function fetchExpense() {
      try {
        const result = await getExpense(id)

        if (!result.success || !result.data) {
          navigate('/404')
          return
        }

        setExpense(result.data)
      } catch (error) {
        console.error('Failed to fetch expense:', error)
        navigate('/404')
      } finally {
        setLoading(false)
      }
    }

    fetchExpense()
  }, [navigate, id])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!expense) {
    return null
  }

  return <ExpenseDetailContent expense={expense} />
}
