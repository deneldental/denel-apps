import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BreadcrumbNav } from '@/components/dashboard/breadcrumb-nav'
import { PeriodCard } from '@/components/shared/period-card'
import { getWeeks } from '@/lib/finance-service'

export default function ExpenseWeeksPage() {
  const { year, month } = useParams<{ year: string; month: string }>()
  const [weeks, setWeeks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!year || !month) return
    async function loadData() {
      try {
        const data = await getWeeks(year!, month!)
        setWeeks(data)
      } catch (error) {
        console.error('Failed to load weeks:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [year, month])

  const displayMonth = month ? month.charAt(0).toUpperCase() + month.slice(1) : ''

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
