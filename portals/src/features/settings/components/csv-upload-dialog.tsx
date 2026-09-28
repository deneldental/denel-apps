import { Download, FileText, Loader2, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { downloadCsv, getTableTemplate, importTableData } from '@/lib/actions/database'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

interface CsvUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableName: string
  onSuccess: () => void
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

export function CsvUploadDialog({
  open,
  onOpenChange,
  tableName,
  onSuccess,
}: CsvUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const { isSubmitting, submit } = useSubmitGuard()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    if (
      selected.type !== 'text/csv' &&
      selected.type !== 'text/plain' &&
      !selected.name.endsWith('.csv')
    ) {
      toast.error('Please select a valid CSV file')
      e.target.value = ''
      return
    }

    if (selected.size > MAX_FILE_SIZE_BYTES) {
      toast.error('File exceeds the 5 MB limit. Please use a smaller CSV.')
      e.target.value = ''
      return
    }

    setFile(selected)
  }

  const handleDownloadTemplate = async () => {
    const result = await getTableTemplate(tableName)
    if (result.success && result.data) {
      downloadCsv(`${tableName}_template.csv`, result.data)
    } else {
      toast.error('Could not download template')
    }
  }

  const handleUpload = () =>
    submit(async () => {
      if (!file) {
        toast.error('Please select a file')
        return
      }

      let text: string
      try {
        text = await file.text()
      } catch {
        toast.error('Failed to read file — it may be corrupted or inaccessible')
        return
      }

      const result = await importTableData(tableName, text)

      if (result.success) {
        toast.success(`Successfully imported ${result.count} records`)
        setFile(null)
        onOpenChange(false)
        onSuccess()
      } else {
        surfaceApiError(result, 'Import failed')
      }
    })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!isSubmitting) onOpenChange(v)
      }}
    >
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
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-fit"
          >
            <Download className="h-3 w-3" />
            Download template
          </button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={!file || isSubmitting}>
            {isSubmitting ? (
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
