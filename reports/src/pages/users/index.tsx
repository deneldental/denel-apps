import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { UserList } from '@/components/users/user-list'
import { getUsers } from '@/lib/actions/users'

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const result = await getUsers()
        setUsers(result.success ? (result.data ?? []) : [])
      } catch (error) {
        console.error('Failed to load users:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <div className="text-muted-foreground">
            Manage system users (Admins, Doctors, Receptionists).
          </div>
        </div>
      </div>

      <UserList data={users} />
    </div>
  )
}
