import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BreadcrumbNav } from '@/components/dashboard/breadcrumb-nav'
import { PeriodCard } from '@/components/shared/period-card'
import { getMonths } from '@/lib/finance-service'

export default function ExpenseMonthsPage() {
  const { year } = useParams<{ year: string }>()
  const [months, setMonths] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!year) return
    async function loadData() {
      try {
        const data = await getMonths(year!)
        setMonths(data)
      } catch (error) {
        console.error('Failed to load months:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [year])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbNav />
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">{year} Expenses</h1>
        <p className="text-muted-foreground">Select a month to view details.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {months.map((month) => (
          <PeriodCard
            key={month.id}
            title={month.name}
            total={month.total}
            href={`/expenses/${year}/${month.id}`}
          />
        ))}
      </div>
    </div>
  )
}
