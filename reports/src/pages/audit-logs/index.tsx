import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import type { AuditLog } from './audit-log-detail-sheet'
import { AuditLogsContent } from './audit-logs-content'

export default function AuditLogsPage() {
  const navigate = useNavigate()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchLogs() {
      try {
        const result = await apiClient<AuditLog[]>('/api/audit-logs?limit=500')
        if (!result.success) {
          navigate('/overview')
          return
        }
        setLogs(result.data || [])
      } catch (error) {
        console.error('Failed to fetch audit logs:', error)
        navigate('/overview')
      } finally {
        setLoading(false)
      }
    }
    fetchLogs()
  }, [navigate])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <AuditLogsContent logs={logs} />
}
