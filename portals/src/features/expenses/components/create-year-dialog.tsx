import { useQueryClient } from '@tanstack/react-query'
import { PlusCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { createExpenseYear } from '@/lib/actions/expenses'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
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
import { ScrollArea } from '@/shared/components/ui/scroll-area'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const createYearSchema = z.object({
  year: z
    .number()
    .int('Year must be a whole number')
    .min(2000, 'Year must be 2000 or later')
    .max(2100, 'Year must be 2100 or earlier'),
  activeMonths: z.array(z.string()).min(1, 'Select at least one active month'),
})

export function CreateYearDialog() {
  const queryClient = useQueryClient()
  const { isSubmitting, submit } = useSubmitGuard()

  const [open, setOpen] = useState(false)
  const [year, setYear] = useState('')
  const [selectedMonths, setSelectedMonths] = useState<string[]>(MONTHS)
  const [yearError, setYearError] = useState<string | null>(null)
  const [monthsError, setMonthsError] = useState<string | null>(null)

  const isDirty = year !== '' || selectedMonths.length !== MONTHS.length

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => setOpen(false),
  })

  // Reset form state when dialog closes
  useEffect(() => {
    if (!open) {
      setYear('')
      setSelectedMonths(MONTHS)
      setYearError(null)
      setMonthsError(null)
    }
  }, [open])

  const toggleMonth = (month: string) => {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month]
    )
    setMonthsError(null)
  }

  const toggleAll = () => {
    setSelectedMonths((prev) => (prev.length === MONTHS.length ? [] : MONTHS))
    setMonthsError(null)
  }

  const handleSubmit = () =>
    submit(async () => {
      setYearError(null)
      setMonthsError(null)

      const parsed = createYearSchema.safeParse({
        year: Number(year),
        activeMonths: selectedMonths,
      })

      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          if (issue.path[0] === 'year') setYearError(issue.message)
          if (issue.path[0] === 'activeMonths') setMonthsError(issue.message)
        }
        return
      }

      const res = await createExpenseYear(parsed.data)

      if (!res.success) {
        surfaceApiError(res)
        return
      }

      toast.success(`Fiscal year ${parsed.data.year} created`)
      await queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
      setOpen(false)
    })

  return (
    <>
      <Dialog open={open} onOpenChange={guardedOnOpenChange}>
        <DialogTrigger asChild>
          <Button onClick={() => setOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Create New Year
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-106.25">
          <DialogHeader>
            <DialogTitle>Create New Year</DialogTitle>
            <DialogDescription>Add a new fiscal year and select active months.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="fiscal-year" className="text-right">
                Year
              </Label>
              <div className="col-span-3 space-y-1">
                <Input
                  id="fiscal-year"
                  placeholder="2026"
                  value={year}
                  maxLength={4}
                  inputMode="numeric"
                  onChange={(e) => {
                    setYear(e.target.value)
                    setYearError(null)
                  }}
                  aria-describedby={yearError ? 'fiscal-year-error' : undefined}
                  aria-invalid={yearError != null}
                />
                {yearError && (
                  <p id="fiscal-year-error" className="text-sm text-destructive">
                    {yearError}
                  </p>
                )}
              </div>
            </div>

            <fieldset className="space-y-4">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium">Active Months</legend>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="select-all-months"
                    checked={selectedMonths.length === MONTHS.length}
                    onCheckedChange={toggleAll}
                  />
                  <label
                    htmlFor="select-all-months"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Select All
                  </label>
                </div>
              </div>

              <ScrollArea className="h-50 w-full rounded-md border p-4">
                <div className="grid grid-cols-2 gap-4">
                  {MONTHS.map((month) => (
                    <div key={month} className="flex items-center space-x-2">
                      <Checkbox
                        id={`month-${month}`}
                        checked={selectedMonths.includes(month)}
                        onCheckedChange={() => toggleMonth(month)}
                      />
                      <label
                        htmlFor={`month-${month}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {month}
                      </label>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {monthsError && (
                <p className="text-sm text-destructive" role="alert">
                  {monthsError}
                </p>
              )}
            </fieldset>
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create Year'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
