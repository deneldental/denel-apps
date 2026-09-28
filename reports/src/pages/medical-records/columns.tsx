import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Eye } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Button } from '@/components/ui/button'

export interface MedicalRecord {
  id: string
  onRowClick?: () => void
  [key: string]: unknown
}

function MedicalRecordActions({ record }: { record: MedicalRecord }) {
  const navigate = useNavigate()

  const handleView = () => {
    if (record?.onRowClick) {
      record.onRowClick()
    } else {
      navigate(`/patient-records/medical-records/${record.id}`)
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleView}>
      <Eye className="mr-2 h-4 w-4" />
      View Details
    </Button>
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

export const columns: ColumnDef<MedicalRecordData>[] = [
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
      return <div className="font-medium">{row.original.patient?.name || 'Unknown'}</div>
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
    cell: ({ row }) => {
      return <MedicalRecordActions record={row.original} />
    },
  },
]
