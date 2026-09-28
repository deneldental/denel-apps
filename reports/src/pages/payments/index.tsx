import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PaymentsContent } from '@/components/payments/payments-content'
import {
  getAllPaymentPlans,
  getOutstandingPaymentPlans,
  getOverduePaymentPlans,
} from '@/lib/actions/payment-plans'
import { getPayments } from '@/lib/actions/payments'

export default function PaymentsPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({
    oneTimePayments: [] as any[],
    planPayments: [] as any[],
    activePlans: [] as any[],
    overduePlans: [] as any[],
    outstandingPlans: [] as any[],
  })

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const [paymentsResult, plansResult, overdueResult, outstandingResult] = await Promise.all([
          getPayments(),
          getAllPaymentPlans(),
          getOverduePaymentPlans(),
          getOutstandingPaymentPlans(),
        ])

        const allPayments = paymentsResult.success ? paymentsResult.data || [] : []
        const activePlans = plansResult.success ? plansResult.data || [] : []
        const overduePlans = overdueResult || []
        const outstandingPlans = outstandingResult || []

        // Separate one-time payments from payment plan payments
        const oneTimePayments = allPayments.filter((p: any) => !p.paymentPlanId)
        const planPayments = allPayments.filter((p: any) => p.paymentPlanId)

        setData({
          oneTimePayments,
          planPayments,
          activePlans,
          overduePlans,
          outstandingPlans,
        })
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <PaymentsContent
      oneTimePayments={data.oneTimePayments}
      planPayments={data.planPayments}
      activePlans={data.activePlans}
      overduePlans={data.overduePlans}
      outstandingPlans={data.outstandingPlans}
    />
  )
}
