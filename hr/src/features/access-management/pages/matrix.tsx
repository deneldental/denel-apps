import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listRoles, type RoleSummary } from '@/lib/actions/roles'
import { EmptyState } from '@/shared/components/empty-state'
import { RolePermissionMatrix } from '../components/role-permission-matrix'

// Portal-scope permission matrix.
export default function MatrixPage() {
  const [roles, setRoles] = useState<RoleSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is unread, only bumped by Retry to force a re-run
  useEffect(() => {
    setLoading(true)
    listRoles().then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setRoles(res.data)
        setError(null)
      } else {
        setError(res.error || 'Failed to load roles')
      }
      setLoading(false)
    })
  }, [attempt])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Failed to load roles"
        description={error}
        action={{ label: 'Retry', onClick: () => setAttempt((n) => n + 1), variant: 'outline' }}
      />
    )
  }

  return <RolePermissionMatrix roles={roles} scope="portal" />
}
