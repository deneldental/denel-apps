import { addDays, format, parseISO } from 'date-fns'
import { Printer } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { PeriodReport } from '@/features/reports/components/period-report'
import { Button } from '@/shared/components/ui/button'

export default function WeeklyDetailPage() {
  const { weekStart = '' } = useParams<{ weekStart: string }>()
  const navigate = useNavigate()

  const start = parseISO(weekStart)
  if (!weekStart || Number.isNaN(start.getTime())) {
    return (
      <div className="p-6 space-y-3 text-center">
        <p className="text-lg font-medium">Invalid week</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/reports/weekly')}>
          Back to weekly summaries
        </Button>
      </div>
    )
  }
  const end = addDays(start, 6)
  const fromStr = format(start, 'yyyy-MM-dd')
  const toStr = format(end, 'yyyy-MM-dd')

  return (
    <div className="p-6 space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <button
          type="button"
          className="hover:text-foreground hover:underline"
          onClick={() => navigate('/reports/weekly')}
        >
          Weekly Summaries
        </button>
        <span className="mx-2">›</span>
        <span className="font-medium text-foreground">
          {format(start, 'MMM d')} – {format(end, 'MMM d, yyyy')}
        </span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Week of {format(start, 'MMM d, yyyy')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(start, 'EEE MMM d')} – {format(end, 'EEE MMM d, yyyy')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-3.5 w-3.5" />
          Print
        </Button>
      </div>

      <PeriodReport from={fromStr} to={toStr} />
    </div>
  )
}
