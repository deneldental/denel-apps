import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Download, Eye, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Button } from '@/components/ui/button'
import { DeleteConfirmationDialog } from '@/components/ui/delete-confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { deleteStaffDocument } from '@/lib/actions/staff'

export type StaffDocument = {
  id: string
  title: string
  description: string | null
  fileUrl: string
  uploadedAt: Date
}

function DocumentActions({ document }: { document: StaffDocument }) {
  const navigate = useNavigate()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const handleDelete = async () => {
    const result = await deleteStaffDocument(document.id)

    if (result.success) {
      toast.success('Document deleted successfully')
      navigate(0)
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
    </>
  )
}

export const columns: ColumnDef<StaffDocument>[] = [
  {
    accessorKey: 'title',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
    cell: ({ row }) => {
      return <div className="font-medium">{row.getValue('title')}</div>
    },
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
      const date = row.getValue('uploadedAt') as Date
      return <div>{format(new Date(date), 'MMM d, yyyy')}</div>
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      return <DocumentActions document={row.original} />
    },
  },
]
