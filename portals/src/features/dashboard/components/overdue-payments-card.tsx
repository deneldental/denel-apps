import { Bell, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { OverduePaymentPlan } from '@/features/dashboard/types'
import { SendReminderButton } from '@/features/payments/components/send-reminder-button'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { formatCurrency } from '@/shared/utils/currency'

interface OverduePaymentsCardProps {
  overduePayments: OverduePaymentPlan[]
}

export function OverduePaymentsCard({ overduePayments }: OverduePaymentsCardProps) {
  const displayPayments = overduePayments.slice(0, 5)

  // Server is authoritative; only re-derive client-side if the response is
  // from an older API without the overdueAmount field.
  const calculateOverdueAmount = (payment: OverduePaymentPlan) => {
    if (typeof payment.overdueAmount === 'number') return payment.overdueAmount
    if (!payment.amountPerInstallment || !payment.paymentFrequency) return 0

    const now = new Date()
    const start = new Date(payment.startDate)
    const diffTime = Math.abs(now.getTime() - start.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    let expectedInstallments = 0
    switch (payment.paymentFrequency) {
      case 'weekly':
        expectedInstallments = Math.floor(diffDays / 7)
        break
      case 'biweekly':
        expectedInstallments = Math.floor(diffDays / 14)
        break
      case 'monthly':
        expectedInstallments = Math.floor(diffDays / 30)
        break
    }

    const expectedAmount = expectedInstallments * payment.amountPerInstallment
    const totalPaid = (payment.payments || []).reduce((sum, p) => sum + p.amount, 0)
    return Math.max(0, expectedAmount - totalPaid)
  }

  if (displayPayments.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Overdue Payments
          </CardTitle>
          <CardDescription>No overdue payments at this time</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Overdue Payments
            </CardTitle>
            <CardDescription>Last {displayPayments.length} overdue payment plans</CardDescription>
          </div>
          <Link to="/payments?tab=overdue">
            <Button variant="ghost" size="sm">
              View All
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {displayPayments.map((payment) => {
            const overdueAmount = calculateOverdueAmount(payment)
            return (
              <div
                key={payment.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-muted/50"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/patients/${payment.patient.id}`}
                      className="font-medium hover:underline"
                    >
                      {payment.patient.name}
                    </Link>
                    {payment.patient.isChild && (
                      <Badge variant="secondary" className="text-xs">
                        Child
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Expected: {formatCurrency(overdueAmount)}
                  </p>
                </div>
                <SendReminderButton
                  patientName={payment.patient.name}
                  patientPhone={payment.patient.phone || ''}
                  guardianPhone={payment.patient.guardianPhone}
                  isChild={payment.patient.isChild}
                  amountDue={overdueAmount}
                />
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
