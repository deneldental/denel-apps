import type { ColumnDef } from '@tanstack/react-table'
import { Eye } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Button } from '@/components/ui/button'

export type Patient = {
  id: string
  patientId: string | null
  name: string
  dob: Date | string | null
  gender: string | null
  type?: string | null
  profileImage?: string | null
  nationality?: string | null
  occupation?: string | null
  email: string | null
  phone: string | null
  address: string | null
  medicalHistory: string | null
  allergies: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  emergencyContactRelation: string | null
  isChild: boolean | null
  isOrtho: boolean | null
  guardianName?: string | null
  guardianPhone?: string | null
  guardianEmail?: string | null
  guardianAddress?: string | null
  guardianOccupation?: string | null
  parentName: string | null
  parentPhone: string | null
  qrCodeUrl: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

function PatientActions({ patient }: { patient: Patient }) {
  const navigate = useNavigate()

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        navigate(`/patient-records/${patient.id}`)
      }}
    >
      <Eye className="mr-2 h-4 w-4" />
      View
    </Button>
  )
}

export const columns: ColumnDef<Patient>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
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
    accessorKey: 'gender',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Gender" />,
    cell: ({ row }) => {
      const gender = row.getValue('gender') as string
      return <div className="capitalize">{gender}</div>
    },
  },
  {
    accessorKey: 'dob',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date of Birth" />,
    cell: ({ row }) => {
      const dob = row.getValue('dob') as Date
      return <div>{dob ? new Date(dob).toLocaleDateString() : '-'}</div>
    },
  },
  {
    accessorKey: 'isChild',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
    cell: ({ row }) => {
      const isChild = row.getValue('isChild') as boolean
      return <div>{isChild ? 'Child' : 'Adult'}</div>
    },
  },
  {
    accessorKey: 'isOrtho',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Ortho" />,
    cell: ({ row }) => {
      const isOrtho = row.getValue('isOrtho') as boolean
      return <div>{isOrtho ? 'Yes' : 'No'}</div>
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      return <PatientActions patient={row.original} />
    },
  },
]
