import { CheckCircle2, ShieldQuestion, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  approveInsurerItem,
  getInsuranceApprovals,
  type InsuranceApprovalItem,
  rejectInsurerItem,
} from '@/lib/actions/insurance-pricing'
import { getServices } from '@/lib/actions/services'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { formatAmount } from '@/shared/utils/currency'

interface OurService {
  id: string
  name: string
  category: string
}

const ghs = (n: number) => `GHS ${formatAmount(Number(n))}`

/**
 * Approvals (P3) — insurer CSV rows that didn't auto-map to one of our services.
 * An admin links each to a real service (creating a remembered alias) or rejects
 * it. Until approved, the row is NOT billable to that insurer.
 */
const APPROVALS_KEY = queryKeys.insurance.approvals()

export default function InsuranceApprovalsPage() {
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const approvalsQuery = useApiQuery<InsuranceApprovalItem[]>(APPROVALS_KEY, getInsuranceApprovals)
  const items = approvalsQuery.data ?? []
  const servicesQuery = useApiQuery<OurService[]>(queryKeys.services.list(), () => getServices())
  const services = (servicesQuery.data ?? []).filter(
    (s) => s.category === 'clinic' || s.category === 'xray'
  )
  const loading = approvalsQuery.isLoading || servicesQuery.isLoading

  const approveMutation = useApiMutation(
    (vars: { id: string; serviceId: string }) => approveInsurerItem(vars.id, vars.serviceId),
    { invalidates: [APPROVALS_KEY] }
  )
  const rejectMutation = useApiMutation((id: string) => rejectInsurerItem(id), {
    invalidates: [APPROVALS_KEY],
  })

  const serviceOptions = useMemo(
    () => [...services].sort((a, b) => a.name.localeCompare(b.name)),
    [services]
  )

  async function handleApprove(item: InsuranceApprovalItem) {
    const serviceId = picks[item.id]
    if (!serviceId) {
      toast.error('Pick the matching service first')
      return
    }
    setBusyId(item.id)
    try {
      await approveMutation.mutateAsync({ id: item.id, serviceId })
      toast.success('Linked — now billable to this insurer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(item: InsuranceApprovalItem) {
    setBusyId(item.id)
    try {
      await rejectMutation.mutateAsync(item.id)
      toast.success('Rejected')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Insurer prices that didn't match one of our services. Link each to a service (or reject).
          Unapproved services can't be billed to the insurer.
        </p>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <ShieldQuestion className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nothing pending approval.</p>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{item.insurerName}</span>
                  {item.insurerCode && (
                    <Badge variant="outline" className="text-[10px]">
                      {item.insurerCode}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {item.companyName ?? 'Unknown insurer'}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Insurer price <span className="tabular-nums">{ghs(item.price)}</span>
                  {item.ourName && ` · CSV suggested "${item.ourName}"`}
                </p>
              </div>
              <div className="w-56">
                <Select
                  value={picks[item.id] ?? ''}
                  onValueChange={(v) => setPicks((p) => ({ ...p, [item.id]: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Link to our service…" />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  onClick={() => handleApprove(item)}
                  disabled={busyId === item.id || !picks[item.id]}
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReject(item)}
                  disabled={busyId === item.id}
                >
                  <XCircle className="mr-1.5 h-3.5 w-3.5" />
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
