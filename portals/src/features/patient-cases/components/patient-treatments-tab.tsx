import { format } from 'date-fns'
import { ChevronDown, Stethoscope } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { accentBorder } from '@/shared/lib/accent-border'
import { formatAmount } from '@/shared/utils/currency'

// Money columns are Postgres numeric(15,2): the API serialises them as strings
// (e.g. "1500.00"), not numbers — hence the `string` in the union below.
type TreatmentItem = {
  id: string
  procedureName: string
  estimatedCost: number | string | null
  status: string | null
  notes: string | null
  phase: number | null
  sortOrder: number | null
}

type TreatmentPlan = {
  id: string
  title: string | null
  totalEstimated: number | string | null
  status: string | null
  createdAt: string
  items: TreatmentItem[]
  /** Every plan belongs to a case; the case number is what we label it with. */
  caseId: string | null
  caseNumber: string | null
}

interface Props {
  patientId: string
}

export function PatientTreatmentsTab({ patientId }: Props) {
  const [plans, setPlans] = useState<TreatmentPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<TreatmentPlan[]>(`/api/treatment-plans/patient/${patientId}`)
    if (res.success && res.data) {
      const data = res.data as TreatmentPlan[]
      setPlans(data)
      if (data.length > 0) setOpenIds(new Set([data[0].id]))
    }
    setLoading(false)
  }, [patientId])

  useEffect(() => {
    load()
  }, [load])

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    )
  }

  if (plans.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
        <Stethoscope className="h-10 w-10 text-muted-foreground/40" />
        <div>
          <p className="font-medium text-muted-foreground">No treatment plans recorded</p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Treatment plans added to patient cases will appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {plans.map((plan) => {
        const isOpen = openIds.has(plan.id)
        const itemCount = plan.items.length
        // Coerce before arithmetic/.toFixed — these arrive as strings, so the
        // raw reduce would string-concatenate ("0" + "100.00" = "0100.00").
        const itemsTotal = plan.items.reduce((s, i) => s + (Number(i.estimatedCost) || 0), 0)
        const total = plan.totalEstimated != null ? Number(plan.totalEstimated) || 0 : itemsTotal

        return (
          <div
            key={plan.id}
            className={cn('rounded-lg border overflow-hidden', accentBorder(plan.id))}
          >
            {/* The case number is a link, so the header can't be one big
                <button> — the chevron carries the toggle instead. */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-muted/20 transition-colors hover:bg-muted/40">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {plan.status && (
                    <Badge variant="outline" className="text-[10px] shrink-0 capitalize">
                      {plan.status.replace('_', ' ')}
                    </Badge>
                  )}
                  {plan.caseId && plan.caseNumber ? (
                    <Link
                      to={`/patients/${patientId}/cases/${plan.caseId}`}
                      className="font-mono text-xs font-medium text-primary hover:underline"
                      title={plan.title ?? undefined}
                    >
                      {plan.caseNumber}
                    </Link>
                  ) : (
                    <span className="truncate text-xs text-muted-foreground">
                      {plan.title ?? 'Treatment Plan'}
                    </span>
                  )}
                  <span className="truncate text-xs text-muted-foreground">
                    · {itemCount} procedure{itemCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(new Date(plan.createdAt), 'MMM d, yyyy')}
                  {total > 0 && ` · GHS ${formatAmount(Number(total))}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggle(plan.id)}
                aria-expanded={isOpen}
                aria-label={isOpen ? 'Hide procedures' : 'Show procedures'}
                className="shrink-0 rounded p-1 hover:bg-muted"
              >
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform duration-200',
                    isOpen && 'rotate-180'
                  )}
                />
              </button>
            </div>

            {isOpen && (
              <div className="px-4 py-3 border-t border-border space-y-2">
                {plan.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No procedures recorded.</p>
                ) : (
                  plan.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border border-border bg-muted/20 px-3 py-2 flex items-start justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {item.procedureName || 'Procedure'}
                        </p>
                        {item.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {item.notes}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.status && (
                          <Badge variant="secondary" className="text-[10px] capitalize">
                            {item.status}
                          </Badge>
                        )}
                        {item.estimatedCost != null && Number(item.estimatedCost) > 0 && (
                          <span className="text-xs font-medium tabular-nums">
                            GHS {formatAmount(Number(item.estimatedCost))}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
