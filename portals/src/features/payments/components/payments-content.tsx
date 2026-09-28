import { lazy, Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AcceptPaymentSheet } from '@/features/payments/components/accept-payment-sheet'
import {
  activePaymentPlanColumns,
  getOneTimePaymentColumns,
  getPlanPaymentColumns,
  type Payment,
  type PaymentPlan,
} from '@/features/payments/pages/columns'
import { DataTable } from '@/shared/components/data-table/data-table'
import { Button } from '@/shared/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'

// Dynamically import the icon
const Plus = lazy(() => import('lucide-react').then((mod) => ({ default: mod.Plus })))

interface PaymentsContentProps {
  oneTimePayments: Payment[]
  planPayments: Payment[]
  activePlans: PaymentPlan[]
  overduePlans: PaymentPlan[]
  outstandingPlans: PaymentPlan[]
  onReload: () => void
}

export function PaymentsContent({
  oneTimePayments,
  planPayments,
  activePlans,
  overduePlans,
  outstandingPlans,
  onReload,
}: PaymentsContentProps) {
  const [showAcceptDialog, setShowAcceptDialog] = useState(false)
  const _navigate = useNavigate()

  const handlePaymentSuccess = () => {
    onReload()
  }

  // Generate columns with onReload support (note: activePaymentPlanColumns might not need it if it doesn't have actions, but we'll see)
  const oneTimeCols = getOneTimePaymentColumns(onReload)
  const planCols = getPlanPaymentColumns(onReload)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground">Track patient payments and invoices.</p>
        </div>
        <Button onClick={() => setShowAcceptDialog(true)}>
          <Suspense fallback={<span className="mr-2">+</span>}>
            <Plus className="mr-2 h-4 w-4" />
          </Suspense>
          Accept Payment
        </Button>
        <AcceptPaymentSheet
          open={showAcceptDialog}
          onOpenChange={setShowAcceptDialog}
          onSuccess={handlePaymentSuccess}
        />
      </div>

      <Tabs defaultValue="active-plans" className="w-full">
        <TabsList>
          <TabsTrigger value="active-plans">Active Plans</TabsTrigger>
          <TabsTrigger value="one-time">One-time Payments</TabsTrigger>
          <TabsTrigger value="transactions">Plan Transactions</TabsTrigger>
          <TabsTrigger value="overdue">Overdue Payments</TabsTrigger>
          <TabsTrigger value="outstanding">Outstanding</TabsTrigger>
        </TabsList>

        <TabsContent value="active-plans">
          <DataTable
            columns={activePaymentPlanColumns}
            data={activePlans}
            initialColumnVisibility={{
              patientId: false,
              status: false,
            }}
          />
        </TabsContent>

        <TabsContent value="one-time">
          <DataTable
            columns={oneTimeCols}
            data={oneTimePayments}
            initialColumnVisibility={{
              additionalNotes: false,
            }}
          />
        </TabsContent>

        <TabsContent value="transactions">
          <DataTable
            columns={planCols}
            data={planPayments}
            initialColumnVisibility={{
              additionalNotes: false,
            }}
          />
        </TabsContent>

        <TabsContent value="overdue">
          <DataTable
            columns={activePaymentPlanColumns}
            data={overduePlans}
            initialColumnVisibility={{
              patientId: false,
              status: false,
              createdAt: false,
            }}
          />
        </TabsContent>

        <TabsContent value="outstanding">
          <DataTable
            columns={activePaymentPlanColumns}
            data={outstandingPlans}
            initialColumnVisibility={{
              patientId: false,
              status: false,
              createdAt: false,
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
