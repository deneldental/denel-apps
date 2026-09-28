import { AlertTriangle, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AddReportSheet } from '@/features/reports/components/add-report-sheet'
import { type DailyReport, getDailyReportColumns } from '@/features/reports/pages/columns'
import { getReportDayWaivers, waiveReportDay } from '@/lib/actions/reports'
import { useCan } from '@/lib/permissions-context'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { DataTable } from '@/shared/components/data-table/data-table'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'

const REPORT_WAIVERS_KEY = ['reports', 'waivers'] as const

interface ReportsContentProps {
  reports: DailyReport[]
  submittedBy: string
  isAdmin?: boolean
  onReload: () => void
}

export function ReportsContent({
  reports,
  submittedBy,
  isAdmin = false,
  onReload,
}: ReportsContentProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const canSubmit = useCan('reports', 'create')
  const [open, setOpen] = useState(searchParams.get('openReport') === '1')
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    // Show loader briefly to ensure content is ready
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  // Honor `?openReport=1` once on mount (e.g. when arriving from the
  // Today's Sales panel) then strip the param so refresh / back doesn't reopen.
  useEffect(() => {
    if (searchParams.get('openReport') === '1') {
      setOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('openReport')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSearchParams, searchParams.get, searchParams])

  const handleSuccess = () => {
    onReload()
  }

  // Days an admin has excused from needing a report (holiday, emergency
  // closure, etc.) — excluded from the missed-days list below.
  const waiversQuery = useApiQuery(REPORT_WAIVERS_KEY, () => getReportDayWaivers())
  const waivedDates = useMemo(
    () => new Set((waiversQuery.data ?? []).map((w) => w.date)),
    [waiversQuery.data]
  )
  const waiveMutation = useApiMutation((date: string) => waiveReportDay(date), {
    invalidates: [REPORT_WAIVERS_KEY],
  })

  async function handleCancelMissed(date: string) {
    try {
      await waiveMutation.mutateAsync(date)
      toast.success(`${date} no longer needs a report.`)
    } catch {
      toast.error('Failed to cancel this missed report')
    }
  }

  // Detect missed days — any of the last 7 weekdays without a submitted report.
  // Today is intentionally excluded (still open). The receptionist sees this as
  // a heads-up; only admins can submit a missed report (or cancel it below).
  const missedDays = useMemo(() => {
    const reportDateKeys = new Set(
      reports.map((r) => {
        try {
          return new Date(r.reportDate as unknown as string).toISOString().slice(0, 10)
        } catch {
          return ''
        }
      })
    )
    const out: string[] = []
    const now = new Date()
    for (let i = 1; i <= 7; i++) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      if (d.getDay() === 0) continue // Sunday — clinic closed, never a missed day
      const key = d.toISOString().slice(0, 10)
      if (!reportDateKeys.has(key) && !waivedDates.has(key)) out.push(key)
    }
    return out
  }, [reports, waivedDates])

  const handleRowClick = (report: DailyReport) => {
    navigate(`/reports/${report.id}`)
  }

  // Add onRowClick handler to each report for row click functionality
  const reportsWithClick = reports.map((report) => ({
    ...report,
    onRowClick: () => handleRowClick(report),
  }))

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">Submit and review daily reports.</p>
        </div>
        {canSubmit && (
          <>
            <Button onClick={() => setOpen(true)}>Add New Report</Button>
            <AddReportSheet
              open={open}
              onOpenChange={setOpen}
              submittedBy={submittedBy}
              onSuccess={handleSuccess}
              isAdmin={isAdmin}
            />
          </>
        )}
      </div>

      {missedDays.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-4 space-y-2">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">
                  {missedDays.length} missed report{missedDays.length === 1 ? '' : 's'}
                </p>
                <p className="text-xs text-amber-800 mt-0.5">
                  {isAdmin
                    ? 'Submit each missed day from the “Add New Report” sheet — pick the past date and record the reason. If a day genuinely needed no report (holiday, emergency closure), cancel it instead.'
                    : 'Some recent days were not submitted. Please ask your administrator to submit them.'}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {missedDays.map((date) => (
                    <span
                      key={date}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-mono text-amber-800"
                    >
                      {date}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleCancelMissed(date)}
                          disabled={waiveMutation.isPending}
                          aria-label={`Cancel missed report for ${date}`}
                          className="rounded-full p-0.5 hover:bg-amber-200 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8 border-t">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading reports...</span>
          </div>
        </div>
      ) : (
        <DataTable
          columns={getDailyReportColumns(onReload)}
          data={reportsWithClick}
          meta={{ onRowClick: handleRowClick }}
        />
      )}
    </div>
  )
}
