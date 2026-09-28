import { formatCurrency } from '@denel/utils'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Transaction } from '@/lib/actions/financials'

interface ReceiptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: Transaction | null
}

export function ReceiptDialog({ open, onOpenChange, transaction }: ReceiptDialogProps) {
  if (!transaction) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {transaction.type === 'income' ? 'Payment' : 'Expense'} Receipt
            <Badge variant={transaction.type === 'income' ? 'default' : 'destructive'}>
              {transaction.type}
            </Badge>
          </DialogTitle>
          <DialogDescription>Transaction details and receipt information</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Receipt Header */}
          <div className="text-center border-b pb-4">
            <h3 className="font-bold text-lg">
              {import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic'}
            </h3>
            <p className="text-sm text-muted-foreground">Official Receipt</p>
          </div>

          {/* Transaction Details */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm font-medium">Date:</span>
              <span className="text-sm">{format(new Date(transaction.date), 'PPP')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium">Time:</span>
              <span className="text-sm">{format(new Date(transaction.date), 'hh:mm a')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium">Category:</span>
              <span className="text-sm capitalize">{transaction.category}</span>
            </div>
            {transaction.description && (
              <div className="flex justify-between">
                <span className="text-sm font-medium">Description:</span>
                <span className="text-sm">{transaction.description}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-sm font-medium">Payment Method:</span>
              <span className="text-sm capitalize">{transaction.paymentMethod || 'Cash'}</span>
            </div>
          </div>

          {/* Amount */}
          <div className="border-t border-b py-4">
            <div className="flex justify-between items-center">
              <span className="font-bold text-lg">Total Amount:</span>
              <span
                className={`font-bold text-2xl ${transaction.type === 'income' ? 'text-green-600' : 'text-red-600'}`}
              >
                {transaction.type === 'expense' && '-'}
                {formatCurrency(transaction.amount)}
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center text-xs text-muted-foreground pt-2">
            <p>Thank you for your business</p>
            <p className="mt-1">Transaction ID: {transaction.id.substring(0, 8)}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
