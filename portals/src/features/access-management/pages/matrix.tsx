import { useEffect, useState } from 'react'
import { RolePermissionMatrix } from '@/features/access-management/components/role-permission-matrix'
import { api } from '@/lib/api-client'

type RoleOption = { id: string; name: string }

export default function MatrixPage() {
  const [roles, setRoles] = useState<RoleOption[]>([])

  useEffect(() => {
    api.get<RoleOption[]>('/api/roles').then((res) => {
      if (res.success && res.data) setRoles(res.data)
    })
  }, [])

  return (
    <div className="p-6">
      {roles.length > 0 ? (
        <RolePermissionMatrix roles={roles} />
      ) : (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          Loading roles…
        </div>
      )}
    </div>
  )
}
