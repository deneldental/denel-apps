import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Download, Eye, Trash2, Upload } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'

export type OrthoConsent = {
  id: string
  patientId: string | null
  name: string
  phone: string | null
  email: string | null
  profileImage: string | null
  consentFormId: string | null
  consentFormUrl: string | null
  status: string
  uploadedAt: Date | null
  notes: string | null
  createdAt: Date
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export const columns: ColumnDef<OrthoConsent>[] = [
  {
    accessorKey: 'patientId',
    header: 'Patient ID',
    cell: ({ row }) => {
      return <div className="font-mono text-sm">{row.original.patientId || 'N/A'}</div>
    },
  },
  {
    accessorKey: 'name',
    header: 'Patient Name',
    cell: ({ row }) => {
      return (
        <div className="flex items-center gap-3 cursor-pointer hover:underline">
          <Avatar className="h-8 w-8">
            <AvatarImage src={row.original.profileImage || undefined} />
            <AvatarFallback>{getInitials(row.original.name)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{row.original.name}</div>
            {row.original.phone && (
              <div className="text-xs text-muted-foreground">{row.original.phone}</div>
            )}
          </div>
        </div>
      )
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.original.status
      return (
        <Badge
          variant={status === 'signed' ? 'default' : 'secondary'}
          className={status === 'signed' ? 'bg-green-500' : ''}
        >
          {status === 'signed' ? 'Signed' : 'Unsigned'}
        </Badge>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    accessorKey: 'uploadedAt',
    header: 'Uploaded At',
    cell: ({ row }) => {
      const uploadedAt = row.original.uploadedAt
      if (!uploadedAt) return <span className="text-muted-foreground text-sm">-</span>
      return <div className="text-sm">{format(new Date(uploadedAt), 'MMM dd, yyyy')}</div>
    },
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row, table }) => {
      interface TableMeta {
        canEdit?: boolean
        onView?: (record: OrthoConsent) => void
        onUpload?: (record: OrthoConsent) => void
        onDelete?: (record: OrthoConsent) => void
      }
      const meta = table.options.meta as TableMeta | undefined
      const hasForm = row.original.status === 'signed'
      const canEdit = meta?.canEdit !== false

      return (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              if (meta?.onView) {
                meta.onView(row.original)
              }
            }}
            title="View consent form page"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {hasForm && row.original.consentFormUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                window.open(row.original.consentFormUrl!, '_blank')
              }}
              title="Download PDF"
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                if (meta?.onUpload) {
                  meta.onUpload(row.original)
                }
              }}
              title="Upload consent form"
            >
              <Upload className="h-4 w-4" />
            </Button>
          )}
          {canEdit && hasForm && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                if (meta?.onDelete) {
                  meta.onDelete(row.original)
                }
              }}
              title="Delete consent form"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      )
    },
  },
]
