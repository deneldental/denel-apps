import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PaymentPlanDetailsContent } from '@/features/payment-plans/components/payment-plan-details-content'
import { ScheduleItemsTable } from '@/features/payment-plans/components/schedule-items-table'
import { getPaymentPlanDetails } from '@/lib/actions/payment-plans'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

export default function PaymentPlanPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // getPaymentPlanDetails() hands back the plan object directly (not an
  // {success,data} envelope), so this reads it with a plain useApiQuery
  // fetcher wrapped to the shape the kit expects.
  const planQuery = useApiQuery(
    queryKeys.paymentPlans.detail(id ?? ''),
    async () => {
      const data = await getPaymentPlanDetails(id as string)
      return { success: !!data, data }
    },
    { enabled: !!id }
  )
  const plan = planQuery.data

  useEffect(() => {
    if (!id) navigate('/payments')
  }, [id, navigate])

  if (!id) return null
  if (planQuery.isLoading) return null
  if (!plan) return null

  return (
    <div className="space-y-4">
      <PaymentPlanDetailsContent plan={plan} />
      <div className="px-6 pb-6">
        <ScheduleItemsTable planId={plan.id} scheduleType={plan.scheduleType ?? plan.type} />
      </div>
    </div>
  )
}
