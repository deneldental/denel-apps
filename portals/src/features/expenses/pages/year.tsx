import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BreadcrumbNav } from '@/features/dashboard/components/breadcrumb-nav'
import { getMonths } from '@/lib/finance-service'
import { useLoading } from '@/lib/loading-context'
import { PeriodCard } from '@/shared/components/period-card'

export default function MonthsPage() {
  const { year } = useParams<{ year: string }>()
  const [months, setMonths] = useState<any[]>([])
  const { isLoading, setIsLoading } = useLoading()

  useEffect(() => {
    if (!year) return

    const load = async () => {
      try {
        setIsLoading(true)
        const data = await getMonths(year)
        setMonths(data)
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [year, setIsLoading])

  if (isLoading) return null

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
