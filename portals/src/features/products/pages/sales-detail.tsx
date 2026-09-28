import { format } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { SalesView } from '@/features/products/components/sales-view'
import { Button } from '@/shared/components/ui/button'

export default function SalesReportDetailPage() {
  const { date } = useParams<{ date: string }>()
  const navigate = useNavigate()

  const isoDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : format(new Date(), 'yyyy-MM-dd')
  const display = format(new Date(isoDate), 'EEEE, MMMM d, yyyy')

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1 h-7 px-2 text-muted-foreground"
            onClick={() => navigate('/store/sales')}
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Back to Sales Reports
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Sales Report</h1>
          <p className="text-sm text-muted-foreground">{display}</p>
        </div>
      </div>

      {/* Read-only — sales reports are part of the daily reports submission. */}
      <SalesView key={isoDate} readOnly initialDate={isoDate} />
    </div>
  )
}
