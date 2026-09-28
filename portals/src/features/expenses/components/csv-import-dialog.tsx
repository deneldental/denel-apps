import { useQueryClient } from '@tanstack/react-query'
import { parse } from 'csv-parse/sync'
import { Download, Loader2, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { createExpense } from '@/lib/actions/expenses'
import { ACTIONS, MODULES } from '@/lib/modules'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

const csvRowSchema = z.object({
  category: z.string().min(1),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'amount must be a positive number with up to 2 decimal places'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  paidTo: z.string().min(1),
  paymentMethod: z.string().min(1),
  description: z.string().optional(),
  attachmentUrl: z.string().url().optional().or(z.literal('')),
})

export function CsvImportDialog() {
  const [open, setOpen] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const { isSubmitting, submit } = useSubmitGuard()
  const { hasPermission } = usePermissions()
  const queryClient = useQueryClient()

  const canCreate = hasPermission(MODULES.EXPENSES as string, ACTIONS.CREATE as string)

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    void submit(async () => {
      try {
        const text = await file.text()
        const rawRecords = parse(text, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        }) as Array<Record<string, string>>

        if (rawRecords.length === 0) {
          toast.error('The CSV file contains no data rows.')
          return
        }

        if (rawRecords.length > 500) {
          toast.error(`CSV has ${rawRecords.length} rows. Maximum allowed is 500.`)
          return
        }

        let successCount = 0
        let errorCount = 0

        setProgress({ current: 0, total: rawRecords.length })

        for (let i = 0; i < rawRecords.length; i++) {
          const raw = rawRecords[i]!
          setProgress({ current: i + 1, total: rawRecords.length })

          // Validate row with Zod schema
          const parsed = csvRowSchema.safeParse(raw)
          if (!parsed.success) {
            errorCount++
            continue
          }

          const row = parsed.data

          try {
            // The API speaks CENTS; the CSV column holds cedis.
            const amount = Math.round(parseFloat(row.amount) * 100)

            const data = {
              category: row.category,
              amount: amount,
              // Send bare YYYY-MM-DD string; backend converts with explicit UTC anchor
              date: row.date as unknown as Date,
              description: row.description || null,
              paidTo: row.paidTo,
              paymentMethod: row.paymentMethod,
              attachmentUrl: row.attachmentUrl || null,
            }

            const result = await createExpense(data)

            if (result.success) {
              successCount++
            } else {
              errorCount++
              surfaceApiError(result, `Row ${i + 1}: failed to import`)
            }
          } catch {
            errorCount++
          }
        }

        setProgress(null)
        setOpen(false)

        if (successCount > 0) {
          toast.success(`Successfully imported ${successCount} expense(s)`)
          queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
        }

        if (errorCount > 0) {
          toast.error(`Failed to import ${errorCount} expense(s)`)
        }
      } catch (error) {
        setProgress(null)
        toast.error('Failed to parse CSV file. Please check the format.')
        console.error('CSV import error:', error)
      }
    })
  }

  if (!canCreate) return null

  return (
    <Dialog open={open} onOpenChange={isSubmitting ? undefined : setOpen}>
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
              key={open ? 'active' : 'reset'}
              id="csv-file"
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              disabled={isSubmitting}
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
          {isSubmitting && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {progress
                ? `Importing expense ${progress.current} of ${progress.total}...`
                : 'Importing expenses...'}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
