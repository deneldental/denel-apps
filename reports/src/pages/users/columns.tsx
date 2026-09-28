import type { ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal, Pencil } from 'lucide-react'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type User = {
  id: string
  name: string
  email: string
  phone: string | null
  roleId: string | null
  banned?: boolean | null
  banReason?: string | null
  banExpires?: Date | string | null
  emailVerified?: boolean | null
  image?: string | null
  createdAt: Date | string
  updatedAt: Date | string
  role?: {
    id: string
    name: string
  } | null
}

interface TableMeta {
  onEdit?: (user: User) => void
  [key: string]: unknown
}

function UserActions({ user: userData, meta }: { user: User; meta?: TableMeta }) {
  const handleEdit = () => {
    if (meta?.onEdit) {
      meta.onEdit(userData)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation()
            handleEdit()
          }}
        >
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const columns: ColumnDef<User>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
  },
  {
    accessorKey: 'email',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
  },
  {
    accessorKey: 'phone',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Phone" />,
    cell: ({ row }) => {
      const phone = row.getValue('phone') as string
      return <div>{phone || '-'}</div>
    },
  },
  {
    accessorKey: 'role',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
    cell: ({ row }) => {
      const role = row.original.role
      return <div className="capitalize">{role?.name || 'No Role'}</div>
    },
  },
  {
    id: 'actions',
    cell: ({ row, table }) => {
      return <UserActions user={row.original} meta={table.options.meta as TableMeta} />
    },
  },
]
