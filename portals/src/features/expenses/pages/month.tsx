import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BreadcrumbNav } from '@/features/dashboard/components/breadcrumb-nav'
import { getWeeks } from '@/lib/finance-service'
import { useLoading } from '@/lib/loading-context'
import { PeriodCard } from '@/shared/components/period-card'

export default function WeeksPage() {
  const { year, month } = useParams<{ year: string; month: string }>()
  const [weeks, setWeeks] = useState<any[]>([])
  const { isLoading, setIsLoading } = useLoading()

  useEffect(() => {
    if (!year || !month) return

    const load = async () => {
      try {
        setIsLoading(true)
        const data = await getWeeks(year, month)
        setWeeks(data)
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [year, month, setIsLoading])

  if (isLoading) return null

  const displayMonth = month ? month.charAt(0).toUpperCase() + month.slice(1) : ''

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbNav />
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">
          {displayMonth} {year} Expenses
        </h1>
        <p className="text-muted-foreground">Select a week to view transactions.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {weeks.map((week) => (
          <PeriodCard
            key={week.id}
            title={week.name}
            total={week.total}
            href={`/expenses/${year}/${month}/${week.id}`}
            subtext={week.range}
          />
        ))}
      </div>
    </div>
  )
}
