import { useQueries, useQueryClient } from '@tanstack/react-query'
import { PaymentsContent } from '@/features/payments/components/payments-content'
import {
  getAllPaymentPlans,
  getOutstandingPaymentPlans,
  getOverduePaymentPlans,
} from '@/lib/actions/payment-plans'
import { getPayments } from '@/lib/actions/payments'
import { queryKeys } from '@/lib/query-keys'

export default function PaymentsPage() {
  const queryClient = useQueryClient()

  const handleReload = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.payments.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.paymentPlans.all })
  }

  const results = useQueries({
    queries: [
      {
        queryKey: queryKeys.payments.list(),
        queryFn: async () => {
          const r = await getPayments()
          return r.success ? (r.data ?? []) : []
        },
      },
      {
        queryKey: queryKeys.paymentPlans.list(),
        queryFn: async () => {
          const r = await getAllPaymentPlans()
          return r.success ? (r.data ?? []) : []
        },
      },
      {
        queryKey: queryKeys.paymentPlans.overdue(),
        queryFn: async () => {
          const r = await getOverduePaymentPlans()
          return Array.isArray(r) ? r : []
        },
      },
      {
        queryKey: queryKeys.paymentPlans.outstanding(),
        queryFn: async () => {
          const r = await getOutstandingPaymentPlans()
          return Array.isArray(r) ? r : []
        },
      },
    ],
  })

  const isLoading = results.some((r) => r.isLoading)
  if (isLoading) return null

  const allPayments = results[0].data ?? []
  const activePlans = results[1].data ?? []
  const overduePlans = results[2].data ?? []
  const outstandingPlans = results[3].data ?? []

  return (
    <PaymentsContent
      oneTimePayments={allPayments.filter((p: any) => !p.paymentPlanId)}
      planPayments={allPayments.filter((p: any) => p.paymentPlanId)}
      activePlans={activePlans}
      overduePlans={overduePlans}
      outstandingPlans={outstandingPlans}
      onReload={handleReload}
    />
  )
}
