import { useState } from 'react'
import { toast } from 'sonner'
import { DataTable } from '@/components/data-table/data-table'
import { columns, type User } from '@/src/pages/users/columns'
import { EditUserDialog } from './edit-user-dialog'
import { UserDetailDialog } from './user-detail-dialog'

interface UserListProps {
  data: User[]
}

export function UserList({ data }: UserListProps) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)

  const handleImportCSV = () => {
    // Create a file input element
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        await file.text()
        // TODO: Implement CSV parsing and import logic
        toast.info('CSV import functionality coming soon')
        // You can parse the CSV here and call an import action
      } catch {
        toast.error('Failed to import CSV file')
      }
    }
    input.click()
  }

  const handleRowClick = (user: User) => {
    setSelectedUser(user)
    setIsDetailDialogOpen(true)
  }

  const handleEdit = (user: User) => {
    setSelectedUser(user)
    setIsEditDialogOpen(true)
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        onImport={handleImportCSV}
        meta={{
          onRowClick: handleRowClick,
          onEdit: handleEdit,
        }}
      />
      <UserDetailDialog
        open={isDetailDialogOpen}
        onOpenChange={setIsDetailDialogOpen}
        user={selectedUser}
      />
      <EditUserDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        user={selectedUser}
      />
    </>
  )
}
