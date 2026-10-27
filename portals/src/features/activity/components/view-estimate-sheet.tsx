import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Button } from '@/shared/components/ui/button'
import { linePriceReading } from '@/shared/utils/invoice-line-display'
import { ghs } from './shared'

type EstimateLine = {
  id: string
  description: string | null
  quantity: number
  unitPrice: number
  /** With `unitPrice`, what a first-unit / additional-unit line's step reads as. */
  lineSubtotal?: number | null
  lineTotal: number
  variantName?: string | null
}

/** The subset of the clinical estimate payload (`GET /api/estimates/:id`) this sheet reads. */
type Estimate = {
  invoiceNumber?: string | null
  status?: string | null
  total?: number | string | null
  lines?: EstimateLine[]
}

/**
 * Loading, failed and loaded are three different things. The sheet used to keep a
 * null status for a failed load and fell through to the "confirmed by reception"
 * wording, so a request the server refused was displayed as a fact about the estimate.
 */
type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; estimate: Estimate }

interface Props {
  estimateInvoiceId: string
  patientName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function describeStatus(status: string | null | undefined): string {
  if (!status) return ''
  if (status === 'draft') return 'Awaiting reception to confirm and take payment.'
  if (status === 'void' || status === 'voided' || status === 'cancelled') {
    return 'This estimate was cancelled.'
  }
  // Only reception issues an estimate, so any other status means they confirmed it.
  return 'This estimate has been confirmed by reception.'
}

/**
 * Read-only view of an estimate the doctor has already built. Pricing is settled
 * at creation time and reception confirms it from the billing lens, so there is
 * deliberately nothing editable here — the doctor is checking what they sent.
 *
 * Reads the clinical `/api/estimates/:id` (lines, quoted totals, status), which a
 * doctor may call; the general invoice endpoint needs payment access.
 */
export function ViewEstimateSheet({ estimateInvoiceId, patientName, open, onOpenChange }: Props) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // `attempt` is not read in the body: bumping it is how Retry re-runs this effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger
  useEffect(() => {
    if (!open) return
    // A response that arrives after the sheet closed, or for another estimate, is stale.
    let current = true
    setState({ phase: 'loading' })
    api
      .get<Estimate>(`/api/estimates/${estimateInvoiceId}`)
      .then((res) => {
        if (!current) return
        if (!res.success || !res.data) {
          setState({ phase: 'error', message: res.error || 'Please try again.' })
          return
        }
        setState({ phase: 'loaded', estimate: res.data })
      })
      .catch((err: unknown) => {
        if (!current) return
        setState({
          phase: 'error',
          message: err instanceof Error && err.message ? err.message : 'Please try again.',
        })
      })
    return () => {
      current = false
    }
  }, [open, estimateInvoiceId, attempt])

  const estimate = state.phase === 'loaded' ? state.estimate : null
  const lines = Array.isArray(estimate?.lines) ? estimate.lines : []
  const description =
    state.phase === 'error'
      ? 'Could not load this estimate.'
      : `${estimate?.invoiceNumber ? `${estimate.invoiceNumber} · ` : ''}${describeStatus(estimate?.status)}`

  return (
    <SheetFormLayout
      open={open}
      onOpenChange={onOpenChange}
      title={`Estimate — ${patientName}`}
      description={description}
      size="md"
      submitLabel="Close"
      onSubmit={() => onOpenChange(false)}
    >
      {state.phase === 'loading' ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : state.phase === 'error' ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-destructive/40 px-4 py-8 text-center"
        >
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-sm font-medium">Could not load this estimate.</p>
          <p className="text-xs text-muted-foreground">{state.message}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {lines.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No lines on this estimate.
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map((l) => (
                <div
                  key={l.id}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {l.description || 'Service'}
                      {l.variantName ? (
                        <span className="text-muted-foreground"> · {l.variantName}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{linePriceReading(l, ghs)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {ghs(Number(l.lineTotal))}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
            <span className="text-sm text-muted-foreground">Estimated total</span>
            <span className="text-lg font-semibold">{ghs(Number(estimate?.total) || 0)}</span>
          </div>
        </>
      )}
    </SheetFormLayout>
  )
}
