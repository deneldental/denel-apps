import type { WorklistVisit } from '@/lib/actions/worklist'
import { Badge } from '@/shared/components/ui/badge'
import { formatCurrency } from '@/shared/utils/currency'

/** Integer CENTS in — every money value in this feature is a cent count. */
export const ghs = (cents: number) => formatCurrency(cents)

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_chair: 'In chair',
  completed: 'Completed',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className="text-[10px] font-medium">
      {STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

/** The estimate-routing state of a visit (only for requires-estimate visits). */
export function EstimateBadge({ visit }: { visit: WorklistVisit }) {
  if (visit.estimateInvoiceStatus === 'paid') {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">
        Paid
      </Badge>
    )
  }
  if (visit.estimateInvoiceStatus === 'partial') {
    return (
      <Badge className="bg-teal-100 text-teal-800 hover:bg-teal-100 text-[10px]">
        Partially Paid
      </Badge>
    )
  }
  if (!visit.requiresEstimate) return null
  const s = visit.estimateStatus
  if (s === 'awaiting_estimate') {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]">
        Needs estimate
      </Badge>
    )
  }
  if (s === 'estimate_ready') {
    return (
      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 text-[10px]">
        Estimate ready
      </Badge>
    )
  }
  if (s === 'invoiced') {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[10px]">Invoiced</Badge>
    )
  }
  return (
    <Badge variant="secondary" className="text-[10px]">
      Requires estimate
    </Badge>
  )
}
