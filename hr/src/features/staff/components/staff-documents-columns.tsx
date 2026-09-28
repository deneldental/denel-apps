import {
  Badge,
  Button,
  DeleteConfirmationDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Download, Eye, History, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { deleteStaffDocument } from '@/lib/actions/staff'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { TagBadge } from '@/shared/components/tag-badge'

export type DocumentAccessLog = {
  id: string
  action: string // 'viewed' | 'downloaded'
  accessedAt: string | Date
}

export type StaffDocument = {
  id: string
  title: string
  description: string | null
  documentType: string | null
  fileUrl: string
  // Serialized over the wire as an ISO string, not a real Date — see the
  // `new Date(date)` wrap in the "Uploaded" column below.
  uploadedAt: string
  accessLogs?: DocumentAccessLog[]
}

function prettyType(value: string | null): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function AccessLogDialog({
  document,
  open,
  onOpenChange,
}: {
  document: StaffDocument
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const logs = [...(document.accessLogs ?? [])].sort(
    (a, b) => new Date(b.accessedAt).getTime() - new Date(a.accessedAt).getTime()
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Access log — {document.title}</DialogTitle>
          <DialogDescription>
            Every time the staff member viewed or downloaded this document.
          </DialogDescription>
        </DialogHeader>
        {logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No access recorded yet.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto text-sm">
            {logs.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-4 py-2">
                <TagBadge label={log.action} className="font-normal capitalize">
                  {log.action}
                </TagBadge>
                <span className="text-muted-foreground">
                  {format(new Date(log.accessedAt), 'MMM d, yyyy · h:mm a')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DocumentActions({
  document,
  onChanged,
}: {
  document: StaffDocument
  onChanged?: () => void | Promise<void>
}) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showAccessLog, setShowAccessLog] = useState(false)

  const handleDelete = async () => {
    const result = await deleteStaffDocument(document.id)

    if (result.success) {
      toast.success('Document deleted successfully')
      await onChanged?.()
    } else {
      toast.error(result.error || 'Failed to delete document')
    }
  }

  const handleView = () => {
    window.open(document.fileUrl, '_blank')
  }

  const handleDownload = () => {
    const link = window.document.createElement('a')
    link.href = document.fileUrl
    link.download = document.title
    link.click()
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
            View
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowAccessLog(true)}>
            <History className="mr-2 h-4 w-4" />
            View access log
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showDeleteDialog && (
        <DeleteConfirmationDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={handleDelete}
          title="Delete Document"
          description="Are you sure you want to delete this document? This action cannot be undone."
          itemName={document.title}
        />
      )}

      {showAccessLog && (
        <AccessLogDialog document={document} open={showAccessLog} onOpenChange={setShowAccessLog} />
      )}
    </>
  )
}

export function buildColumns(onChanged?: () => void | Promise<void>): ColumnDef<StaffDocument>[] {
  return [
    {
      accessorKey: 'title',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
      cell: ({ row }) => {
        return <div className="font-medium">{row.getValue('title')}</div>
      },
    },
    {
      accessorKey: 'documentType',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
      cell: ({ row }) => (
        <TagBadge label={row.original.documentType ?? undefined} className="font-normal">
          {prettyType(row.original.documentType)}
        </TagBadge>
      ),
    },
    {
      accessorKey: 'description',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
      cell: ({ row }) => {
        const description = row.getValue('description') as string | null
        return <div className="max-w-[300px] truncate">{description || '-'}</div>
      },
    },
    {
      accessorKey: 'uploadedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Uploaded" />,
      cell: ({ row }) => {
        const date = row.getValue('uploadedAt') as string
        return <div>{format(new Date(date), 'MMM d, yyyy')}</div>
      },
    },
    {
      id: 'accessLog',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Accessed" />,
      cell: ({ row }) => {
        const logs = row.original.accessLogs ?? []
        if (logs.length === 0) {
          return <span className="text-muted-foreground">—</span>
        }
        const last = logs.reduce((a, b) =>
          new Date(a.accessedAt) > new Date(b.accessedAt) ? a : b
        )
        return (
          <div className="flex flex-col gap-0.5">
            <Badge variant="secondary" className="w-fit font-normal">
              {logs.length} {logs.length === 1 ? 'access' : 'accesses'}
            </Badge>
            <span className="text-xs text-muted-foreground">
              last {format(new Date(last.accessedAt), 'MMM d, yyyy')}
            </span>
          </div>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        return <DocumentActions document={row.original} onChanged={onChanged} />
      },
    },
  ]
}

// Legacy export retained for callers that don't yet pass an onChanged handler.
// New call sites should use `buildColumns(load)` so deletions can refresh the
// parent without a full-page reload.
export const columns: ColumnDef<StaffDocument>[] = buildColumns()
