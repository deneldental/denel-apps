import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getAuditLogs } from '@/lib/actions/audit-logs'
import { queryKeys } from '@/lib/query-keys'
import { AuditLogsContent } from './audit-logs-content'

const LIMIT = 500

export default function AuditLogsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // §19.2 — entity drill-down. A deep link (/audit-logs?entityId=<id>) pre-filters
  // the page server-side to a single entity's history.
  const entityId = searchParams.get('entityId') ?? undefined

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.auditLogs.list(LIMIT, entityId),
    queryFn: () => getAuditLogs(LIMIT, entityId),
    select: (result) => {
      if (!result.success) throw new Error('Failed to load audit logs')
      return result.data ?? []
    },
  })

  if (isError) {
    navigate('/dashboard')
    return null
  }

  if (isLoading) return <div className="p-6">Loading audit logs...</div>

  const clearEntityFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('entityId')
    setSearchParams(next, { replace: true })
  }

  const filterByEntity = (id: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('entityId', id)
    setSearchParams(next, { replace: true })
  }

  return (
    <AuditLogsContent
      logs={data ?? []}
      entityFilter={entityId}
      onClearEntityFilter={clearEntityFilter}
      onFilterByEntity={filterByEntity}
    />
  )
}
