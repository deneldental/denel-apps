// Generate-statement dialog (M2.2) — free date-range picker (no presets).
// Calls POST /api/patient-statements/patient/:patientId and notifies the
// parent on success so the statements list can refetch.

import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
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
import { localDateISO } from '@/shared/lib/dates'

interface GenerateStatementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  onGenerated?: () => void
}

export function GenerateStatementDialog({
  open,
  onOpenChange,
  patientId,
  onGenerated,
}: GenerateStatementDialogProps) {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isSubmitting, submit } = useSubmitGuard()

  // Reset state whenever the dialog is opened.
  useEffect(() => {
    if (open) {
      const today = new Date()
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      setFromDate(localDateISO(firstOfMonth))
      setToDate(localDateISO(today))
      setError(null)
    }
  }, [open])

  const invalidRange = fromDate && toDate && fromDate > toDate

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!fromDate || !toDate) {
      setError('Both dates are required')
      return
    }

    await submit(async () => {
      const res = await api.post<{
        id: string
        downloadUrl: string
        fromDate: string
        toDate: string
      }>(
        `/api/patient-statements/patient/${patientId}`,
        {
          fromDate: `${fromDate}T00:00:00`,
          toDate: `${toDate}T23:59:59.999`,
        },
        { timeout: 120_000 }
      )

      if (!res.success) {
        const msg = res.error ?? 'Failed to generate statement'
        setError(msg)
        surfaceApiError(res, 'Failed to generate statement')
        return
      }

      toast.success('Statement generated')
      onOpenChange(false)
      onGenerated?.()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Statement</DialogTitle>
          <DialogDescription>
            Pick a date range — the statement will include all ledger activity within it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="statement-from">From</Label>
              <Input
                id="statement-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                max={toDate || undefined}
                disabled={isSubmitting}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="statement-to">To</Label>
              <Input
                id="statement-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                min={fromDate || undefined}
                disabled={isSubmitting}
                required
              />
            </div>
          </div>

          {invalidRange && (
            <p className="text-xs text-destructive">From date must be on or before To date.</p>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !!invalidRange}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                'Generate'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
