import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { deleteMedicalRecord } from '@/lib/actions/medical-records'
import { useCan } from '@/lib/permissions-context'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'

export interface MedicalRecord {
  id: string
  onRowClick?: () => void
  [key: string]: unknown
}

function MedicalRecordActions({
  record,
  onReload,
}: {
  record: MedicalRecord
  onReload: () => void
}) {
  const navigate = useNavigate()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  // Permission-gated, not role-gated — doctors hold `medical_records:*` and are
  // the ones authoring these records.
  const canEdit = useCan('medical_records', 'update')
  const canDelete = useCan('medical_records', 'delete')

  const handleDelete = async () => {
    const result = await deleteMedicalRecord(record.id)
    if (result.success) {
      toast.success('Medical record deleted successfully')
      setShowDeleteDialog(false)
      onReload()
    } else {
      toast.error(result.error || 'Failed to delete medical record')
    }
  }

  const handleView = () => {
    if (record?.onRowClick) {
      record.onRowClick()
    } else {
      navigate(`/medical-records/${record.id}`)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Open menu</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleView}>
            <Eye className="mr-2 h-4 w-4" />
            View Details
          </DropdownMenuItem>
          {canEdit && (
            <DropdownMenuItem>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              {canEdit && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
        title="Delete Medical Record"
        description="Are you sure you want to delete this medical record? This action cannot be undone."
      />
    </>
  )
}

export interface MedicalRecordData {
  id: string
  date: Date | string
  createdAt: Date | string
  patient?: {
    name: string
  }
  doctor?: {
    user?: {
      name: string
    }
  }
  [key: string]: unknown
}

export const getColumns = (onReload: () => void): ColumnDef<MedicalRecordData>[] => [
  {
    accessorKey: 'date',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => {
      const date = new Date(row.original.createdAt)
      return <div>{format(date, 'MMM d, yyyy')}</div>
    },
  },
  {
    accessorKey: 'patient.name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Patient" />,
    cell: ({ row }) => {
      const patientId = row.original.patientId as string | undefined
      const name = row.original.patient?.name || 'Unknown'
      if (patientId) {
        return (
          <Link
            to={`/medical-records/patient/${patientId}`}
            className="font-medium hover:underline text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            {name}
          </Link>
        )
      }
      return <div className="font-medium">{name}</div>
    },
  },
  {
    accessorKey: 'complaint',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Complaint" />,
    cell: ({ row }) => {
      const complaint = row.getValue('complaint') as string
      return <div className="max-w-[200px] truncate">{complaint || '-'}</div>
    },
  },
  {
    accessorKey: 'treatment',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Treatment" />,
    cell: ({ row }) => {
      const treatment = row.getValue('treatment') as string
      return <div className="max-w-[200px] truncate">{treatment || '-'}</div>
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
    id: 'actions',
    cell: ({ row }) => <MedicalRecordActions record={row.original} onReload={onReload} />,
  },
]
