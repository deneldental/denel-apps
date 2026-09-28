import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Appointment } from '@/features/appointments/components/appointment-detail-dialog'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'

export interface AppointmentData extends Appointment {
  onRowClick?: () => void
}

export const columns: ColumnDef<AppointmentData>[] = [
  {
    accessorKey: 'date',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => {
      const date = new Date(row.getValue('date'))
      return <div>{format(date, 'MMM d, yyyy')}</div>
    },
  },
  {
    id: 'time',
    accessorKey: 'date',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Time" />,
    cell: ({ row }) => {
      const date = new Date(row.getValue('date'))
      return <div>{format(date, 'h:mm a')}</div>
    },
  },
  {
    accessorKey: 'patient.name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Patient" />,
    cell: ({ row }) => {
      return <div className="font-medium">{row.original.patient?.name || 'Unknown'}</div>
    },
  },
  {
    accessorKey: 'doctor.user.name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Doctor" />,
    cell: ({ row }) => {
      return <div>{row.original.doctor?.user?.name || 'Unknown'}</div>
    },
  },
  {
    accessorKey: 'type',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
    cell: ({ row }) => {
      return <div className="capitalize">{row.getValue('type')}</div>
    },
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
      const status = row.getValue('status') as string
      return (
        <Badge
          variant={
            status === 'scheduled'
              ? 'warning'
              : status === 'completed'
                ? 'success'
                : status === 'cancelled'
                  ? 'destructive'
                  : 'outline'
          }
        >
          {status}
        </Badge>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const appointment = row.original

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => appointment.onRowClick?.()}>
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]
