import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ReportDetailContent } from '@/features/reports/components/report-detail-content'
import { getDailyReportById } from '@/lib/actions/reports'
import { useLoading } from '@/lib/loading-context'
import { useApiQuery } from '@/lib/query'
import type { DailyReport } from './columns'

// Local query key — reports has no matching group in `query-keys.ts`.
const dailyReportKey = (id: string) => ['reports', 'daily-report', id] as const

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const _navigate = useNavigate()
  const { setIsLoading } = useLoading()

  const reportQuery = useApiQuery<DailyReport>(
    dailyReportKey(id ?? ''),
    () => getDailyReportById(id as string),
    { enabled: id !== undefined }
  )
  const report = reportQuery.data ?? null
  const isLoading = reportQuery.isLoading
  const error =
    id === undefined
      ? 'Report ID is missing'
      : reportQuery.isError
        ? (reportQuery.error?.message ?? 'Failed to fetch report')
        : null

  // Mirror into the shared reference-counted loading context, same as every
  // other migrated page.
  useEffect(() => {
    setIsLoading(reportQuery.isFetching)
  }, [reportQuery.isFetching, setIsLoading])

  if (isLoading) return null
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>
  if (!report) return <div className="p-8 text-center text-muted-foreground">Report not found</div>

  return <ReportDetailContent report={report} />
}
