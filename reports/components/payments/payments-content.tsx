import { DataTable } from '@/components/data-table/data-table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  activePaymentPlanColumns,
  oneTimePaymentColumns,
  type Payment,
  type PaymentPlan,
  planPaymentColumns,
} from '@/src/pages/payments/columns'

interface PaymentsContentProps {
  oneTimePayments: Payment[]
  planPayments: Payment[]
  activePlans: PaymentPlan[]
  overduePlans: PaymentPlan[]
  outstandingPlans: PaymentPlan[]
}

export function PaymentsContent({
  oneTimePayments,
  planPayments,
  activePlans,
  overduePlans,
  outstandingPlans,
}: PaymentsContentProps) {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground">View patient payments and invoices.</p>
        </div>
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
            columns={oneTimePaymentColumns}
            data={oneTimePayments}
            initialColumnVisibility={{
              additionalNotes: false,
            }}
          />
        </TabsContent>

        <TabsContent value="transactions">
          <DataTable
            columns={planPaymentColumns}
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
