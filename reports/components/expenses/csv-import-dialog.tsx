import { parse } from 'csv-parse/sync'
import { Download, Loader2, Upload } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createExpense } from '@/lib/actions/expenses'

export function CsvImportDialog() {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setIsLoading(true)

    try {
      const text = await file.text()
      const records = parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<{
        category: string
        amount: string
        date: string
        paidTo: string
        paymentMethod: string
        description?: string
        attachmentUrl?: string
      }>

      let successCount = 0
      let errorCount = 0

      for (const record of records) {
        try {
          const amount = parseFloat(record.amount) // Amount is already in GHS

          // Validate all required fields
          if (
            Number.isNaN(amount) ||
            !record.category ||
            !record.date ||
            !record.paidTo ||
            !record.paymentMethod
          ) {
            errorCount++
            continue
          }

          const data = {
            category: record.category,
            amount: amount,
            date: new Date(record.date),
            description: record.description || null,
            paidTo: record.paidTo,
            paymentMethod: record.paymentMethod,
            attachmentUrl: record.attachmentUrl || null,
          }

          const result = await createExpense(data)

          if (result.success) {
            successCount++
          } else {
            errorCount++
          }
        } catch {
          errorCount++
        }
      }

      setIsLoading(false)
      setOpen(false)

      if (successCount > 0) {
        toast.success(`Successfully imported ${successCount} expense(s)`)
        navigate(0)
      }

      if (errorCount > 0) {
        toast.error(`Failed to import ${errorCount} expense(s)`)
      }
    } catch (error) {
      setIsLoading(false)
      toast.error('Failed to parse CSV file. Please check the format.')
      console.error('CSV import error:', error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Expenses from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to bulk import expenses. Download the template to see the required
            format.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="csv-file">CSV File</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              disabled={isLoading}
            />
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/templates/expenses-template.csv"
              download
              className="text-sm text-blue-600 hover:underline flex items-center gap-1"
            >
              <Download className="h-4 w-4" />
              Download Template CSV
            </a>
          </div>
          <div className="text-sm text-muted-foreground">
            <p className="font-semibold mb-2">CSV Format:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>category (required)</li>
              <li>amount (required, in decimal format e.g., 100.50)</li>
              <li>date (required, YYYY-MM-DD format)</li>
              <li>paidTo (required)</li>
              <li>paymentMethod (required)</li>
              <li>description (optional)</li>
              <li>attachmentUrl (optional, URL to file)</li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing expenses...
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
