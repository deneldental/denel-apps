import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PaymentPlanDetailsContent } from '@/components/payment-plans/payment-plan-details-content'
import { getPaymentPlanDetails } from '@/lib/actions/payment-plans'
import { ACTIONS, MODULES } from '@/lib/modules'
import { checkPermission, getCurrentUser } from '@/lib/rbac'

export default function PaymentPlanPage() {
  const navigate = useNavigate()
  const params = useParams()
  const id = params.id as string
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<any>(null)

  useEffect(() => {
    async function fetchPaymentPlan() {
      try {
        const currentUser = await getCurrentUser()
        if (!currentUser) {
          navigate('/404')
          return
        }

        const hasPermission = await checkPermission(currentUser.id, MODULES.PATIENTS, ACTIONS.READ)
        if (!hasPermission) {
          navigate('/404')
          return
        }

        const result = await getPaymentPlanDetails(id)

        if (!result.success || !result.data) {
          navigate('/404')
          return
        }

        setPlan(result.data)
      } catch (error) {
        console.error('Failed to fetch payment plan:', error)
        navigate('/404')
      } finally {
        setLoading(false)
      }
    }

    fetchPaymentPlan()
  }, [navigate, id])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!plan) {
    return null
  }

  return <PaymentPlanDetailsContent plan={plan} />
}
