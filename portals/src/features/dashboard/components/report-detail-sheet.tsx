import { format } from 'date-fns'
import { FileText, Loader2 } from 'lucide-react'
import type { RecentReport } from '@/features/dashboard/types'
import { ReportDetailContent } from '@/features/reports/components/report-detail-content'
import type { DailyReport } from '@/features/reports/pages/columns'
import { getDailyReportById } from '@/lib/actions/reports'
import { useApiQuery } from '@/lib/query'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'

interface ReportDetailSheetProps {
  report: RecentReport | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Local key — the dashboard's own "recent reports" detail lookup by id. */
const dailyReportDetailKey = (id: string) => ['reports', 'daily-report', id] as const

/**
 * §1.2 — Dashboard "Recent Reports" detail sheet.
 *
 * Previously this only showed a four-stat summary. It now renders the full
 * daily report by reusing the canonical `/reports/:id` detail view
 * (`ReportDetailContent`). The dashboard list only carries summary fields
 * (`RecentReport`), so we fetch the full `DailyReport` by id on open.
 */
export function ReportDetailSheet({ report, open, onOpenChange }: ReportDetailSheetProps) {
  const reportId = report?.id ?? null

  const reportQuery = useApiQuery(
    dailyReportDetailKey(reportId ?? 'none'),
    () => getDailyReportById(reportId as string),
    { enabled: open && !!reportId }
  )
  const fullReport = (reportQuery.data as DailyReport | undefined) ?? null
  const isLoading = open && !!reportId && reportQuery.isLoading
  const error = reportQuery.isError ? reportQuery.error.message || 'Failed to load report' : null

  if (!report) return null

  const reportDate = new Date(report.reportDate)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full !max-w-[760px] !p-0 flex flex-col gap-0 sm:!max-w-[760px]"
      >
        <SheetHeader className="shrink-0 space-y-1 border-b px-6 pt-6 pb-4 text-left">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Daily Report
          </SheetTitle>
          <SheetDescription>{format(reportDate, 'EEEE, MMMM d, yyyy')}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading full report…
            </div>
          ) : error ? (
            <div className="px-6 py-16 text-center text-sm text-red-500">{error}</div>
          ) : fullReport ? (
            <ReportDetailContent report={fullReport} onBack={() => onOpenChange(false)} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
