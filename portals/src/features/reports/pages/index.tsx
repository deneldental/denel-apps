import { useEffect, useState } from 'react'
import { ReportsContent } from '@/features/reports/components/reports-content'
import { getDailyReports } from '@/lib/actions/reports'
import { authClient } from '@/lib/auth-client'
import { useLoading } from '@/lib/loading-context'
import { usePermissions } from '@/lib/permissions-context'
import { useApiQuery } from '@/lib/query'
import type { DailyReport } from './columns'

// Local query key — reports has no matching group in `query-keys.ts`.
const DAILY_REPORTS_KEY = ['reports', 'daily-reports'] as const

export default function ReportsPage() {
  const [submittedBy, setSubmittedBy] = useState('Unknown User')
  const { setIsLoading } = useLoading()
  const permissions = usePermissions()
  const isAdmin = !!permissions?.isAdmin

  // Session lookup is independent of the reports list — better-auth's own
  // client, not a `lib/actions` fetcher, so it stays a plain effect.
  useEffect(() => {
    authClient.getSession().then(({ data: sessionData }) => {
      if (sessionData?.user) {
        setSubmittedBy(sessionData.user.name || sessionData.user.email || 'Unknown User')
      }
    })
  }, [])

  const reportsQuery = useApiQuery<DailyReport[]>(DAILY_REPORTS_KEY, () => getDailyReports())
  const reports = reportsQuery.data ?? []

  // Mirror into the shared reference-counted loading context, same as every
  // other migrated page.
  useEffect(() => {
    setIsLoading(reportsQuery.isFetching)
  }, [reportsQuery.isFetching, setIsLoading])

  if (reportsQuery.isLoading) return null

  return (
    <ReportsContent
      reports={reports}
      submittedBy={submittedBy}
      isAdmin={isAdmin}
      onReload={() => reportsQuery.refetch()}
    />
  )
}
