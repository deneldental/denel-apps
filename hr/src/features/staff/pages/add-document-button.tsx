import { Button } from '@denel/ui'
import { Upload } from 'lucide-react'
import { useState } from 'react'
import { AddDocumentDialog } from '@/features/staff/components/add-document-dialog'

interface AddDocumentButtonProps {
  staffId: string
  staffName: string
  onUploaded?: () => void | Promise<void>
}

export function AddDocumentButton({ staffId, staffName, onUploaded }: AddDocumentButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Add Document
      </Button>
      <AddDocumentDialog
        staffId={staffId}
        staffName={staffName}
        open={open}
        onOpenChange={setOpen}
        onUploaded={onUploaded}
      />
    </>
  )
}
