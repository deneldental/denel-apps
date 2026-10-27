import { FileQuestion, Lock, TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PaymentPlanDetailsContent } from '@/features/payment-plans/components/payment-plan-details-content'
import { ScheduleItemsTable } from '@/features/payment-plans/components/schedule-items-table'
import { getPaymentPlanDetails } from '@/lib/actions/payment-plans'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { EmptyState } from '@/shared/components/empty-state'
import { Skeleton } from '@/shared/components/ui/skeleton'

/** What the API says for a plan that is not there (404) or an id that is not one (400). */
const NOT_FOUND = /not found|invalid payment plan id|\(404\)/i
const FORBIDDEN = /^unauthorized$/i

export default function PaymentPlanPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const planQuery = useApiQuery(
    queryKeys.paymentPlans.detail(id ?? ''),
    () => getPaymentPlanDetails(id as string),
    { enabled: !!id }
  )

  useEffect(() => {
    if (!id) navigate('/payments')
  }, [id, navigate])

  if (!id) return null

  if (planQuery.isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading payment plan"
        className="flex flex-col gap-6 p-6"
      >
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  const plan = planQuery.data
  if (planQuery.isError || !plan) {
    const message = planQuery.error?.message ?? ''
    const backToPayments = { label: 'Back to payments', onClick: () => navigate('/payments') }
    if (FORBIDDEN.test(message)) {
      return (
        <EmptyState
          icon={Lock}
          title="You don't have access to payment plans"
          description="Ask an administrator to give your role access to payments."
          action={backToPayments}
        />
      )
    }
    if (!planQuery.isError || NOT_FOUND.test(message)) {
      return (
        <EmptyState
          icon={FileQuestion}
          title="Payment plan not found"
          description="It may have been deleted, or the link may be wrong."
          action={backToPayments}
        />
      )
    }
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Could not load this payment plan"
        description={message || 'Something went wrong. Please try again.'}
        action={{ label: 'Try again', onClick: () => void planQuery.refetch() }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <PaymentPlanDetailsContent plan={plan} />
      <div className="px-6 pb-6">
        <ScheduleItemsTable planId={plan.id} scheduleType={plan.scheduleType ?? plan.type} />
      </div>
    </div>
  )
}
