import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { ghs } from './shared'

type EstimateLine = {
  id: string
  description: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
  variantName?: string | null
}

/** The subset of the invoice payload this dialog reads. */
type EstimateInvoice = {
  invoiceNumber?: string | null
  status?: string | null
  total?: number | string | null
  lines?: EstimateLine[]
}

interface Props {
  estimateInvoiceId: string
  patientName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Read-only view of an estimate the doctor has already built. Pricing is settled
 * at creation time and reception confirms it from the billing lens, so there is
 * deliberately nothing editable here — the doctor is checking what they sent.
 */
export function ViewEstimateSheet({ estimateInvoiceId, patientName, open, onOpenChange }: Props) {
  const [lines, setLines] = useState<EstimateLine[]>([])
  const [total, setTotal] = useState(0)
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    api.get<EstimateInvoice>(`/api/invoices/${estimateInvoiceId}`).then((res) => {
      setLoading(false)
      if (!res.success || !res.data) return
      const inv = res.data
      setLines(Array.isArray(inv.lines) ? inv.lines : [])
      setTotal(Number(inv.total) || 0)
      setInvoiceNumber(inv.invoiceNumber ?? null)
      setStatus(inv.status ?? null)
    })
  }, [open, estimateInvoiceId])

  return (
    <SheetFormLayout
      open={open}
      onOpenChange={onOpenChange}
      title={`Estimate — ${patientName}`}
      description={`${invoiceNumber ? `${invoiceNumber} · ` : ''}${
        status === 'draft'
          ? 'Awaiting reception to confirm and take payment.'
          : 'This estimate has been confirmed by reception.'
      }`}
      size="md"
      submitLabel="Close"
      onSubmit={() => onOpenChange(false)}
    >
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : lines.length === 0 ? (
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
                <p className="text-xs text-muted-foreground">
                  {ghs(Number(l.unitPrice))} × {Number(l.quantity)}
                </p>
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
        <span className="text-lg font-semibold">{ghs(total)}</span>
      </div>
    </SheetFormLayout>
  )
}
