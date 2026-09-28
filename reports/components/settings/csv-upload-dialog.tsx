import { FileText, Loader2, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { importTableData } from '@/lib/actions/database'

interface CsvUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableName: string
  onSuccess: () => void
}

export function CsvUploadDialog({
  open,
  onOpenChange,
  tableName,
  onSuccess,
}: CsvUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0])
    }
  }

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select a file')
      return
    }

    setIsUploading(true)
    try {
      const text = await file.text()
      const result = await importTableData(tableName, text)

      if (result.success) {
        toast.success(`Successfully imported ${result.count} records`)
        setFile(null)
        onOpenChange(false)
        onSuccess()
      } else {
        toast.error(result.error || 'Import failed')
      }
    } catch (_error) {
      toast.error('Failed to read file')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload CSV for {tableName.replace(/_/g, ' ')}</DialogTitle>
          <DialogDescription>
            Select a CSV file to import. Ensure the headers match the template.
          </DialogDescription>
        </DialogHeader>

        <div className="grid w-full max-w-sm items-center gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="csv-file">CSV File</Label>
            <Input id="csv-file" type="file" accept=".csv" onChange={handleFileChange} />
          </div>
          {file && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted p-2 rounded">
              <FileText className="h-4 w-4" />
              <span className="truncate">{file.name}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isUploading}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={!file || isUploading}>
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Import
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
