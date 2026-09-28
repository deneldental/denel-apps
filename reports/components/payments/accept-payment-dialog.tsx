import { CreditCard, Receipt } from 'lucide-react'
import { useState } from 'react'
import { OneTimePaymentDialog } from '@/components/payments/one-time-payment-dialog'
import { PlanPaymentDialog } from '@/components/payments/plan-payment-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface AcceptPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function AcceptPaymentDialog({ open, onOpenChange, onSuccess }: AcceptPaymentDialogProps) {
  const [paymentType, setPaymentType] = useState<'one-time' | 'plan' | null>(null)

  const handleTypeSelect = (type: 'one-time' | 'plan') => {
    setPaymentType(type)
  }

  const handleClose = (open: boolean) => {
    if (!open) {
      setPaymentType(null)
    }
    onOpenChange(open)
  }

  if (paymentType === 'one-time') {
    return (
      <OneTimePaymentDialog
        open={open}
        onOpenChange={handleClose}
        onSuccess={() => {
          setPaymentType(null)
          onSuccess?.()
        }}
      />
    )
  }

  if (paymentType === 'plan') {
    return (
      <PlanPaymentDialog
        open={open}
        onOpenChange={handleClose}
        onSuccess={() => {
          setPaymentType(null)
          onSuccess?.()
        }}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Accept Payment</DialogTitle>
          <DialogDescription>Select the type of payment you want to accept.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Button
            variant="outline"
            className="h-20 flex-col gap-2"
            onClick={() => handleTypeSelect('one-time')}
          >
            <Receipt className="h-6 w-6" />
            <span>One-time Payment</span>
          </Button>
          <Button
            variant="outline"
            className="h-20 flex-col gap-2"
            onClick={() => handleTypeSelect('plan')}
          >
            <CreditCard className="h-6 w-6" />
            <span>Payment Plan</span>
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
