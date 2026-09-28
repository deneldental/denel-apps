import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getExpenseCategories } from '@/lib/actions/expense-categories'
import { updateExpense } from '@/lib/actions/expenses'
import { getPaymentMethods } from '@/lib/actions/payment-methods'
import type { Expense } from '@/src/pages/expenses/columns'

interface EditExpenseDialogProps {
  expense: Expense
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditExpenseDialog({ expense, open, onOpenChange }: EditExpenseDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const [category, setCategory] = useState<string>(expense.category || '')
  const [paymentMethod, setPaymentMethod] = useState<string>(expense.paymentMethod || '')
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string; displayName: string | null }>
  >([])
  const [paymentMethods, setPaymentMethods] = useState<
    Array<{ id: string; name: string; displayName: string | null }>
  >([])

  // Update state when expense changes - done during render to avoid cascading updates
  const [prevExpenseId, setPrevExpenseId] = useState(expense.id)
  if (expense.id !== prevExpenseId) {
    setPrevExpenseId(expense.id)
    setCategory(expense.category || '')
    setPaymentMethod(expense.paymentMethod || '')
  }

  // Load categories and payment methods when dialog opens
  useEffect(() => {
    if (open) {
      getExpenseCategories().then((result) => {
        if (result.success && result.data) {
          setCategories(result.data)
        }
      })
      getPaymentMethods().then((result) => {
        if (result.success && result.data) {
          setPaymentMethods(result.data)
        }
      })
    }
  }, [open])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    const formData = new FormData(event.currentTarget)

    const amount = parseFloat(formData.get('amount') as string) // Amount is already in GHS
    const date = formData.get('date') as string
    const description = formData.get('description') as string
    const paidTo = formData.get('paidTo') as string
    const file = formData.get('attachment') as File | null

    if (Number.isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount')
      setIsLoading(false)
      return
    }

    if (!category) {
      toast.error('Please select a category')
      setIsLoading(false)
      return
    }

    if (!paymentMethod) {
      toast.error('Please select a payment method')
      setIsLoading(false)
      return
    }

    if (!paidTo || paidTo.trim() === '') {
      toast.error('Please enter who this expense was paid to')
      setIsLoading(false)
      return
    }

    let attachmentUrl: string | null | undefined

    // Upload file if provided
    if (file && file.size > 0) {
      const { uploadExpenseFile } = await import('@/lib/actions/upload')
      const uploadResult = await uploadExpenseFile({
        file,
        category,
        paidTo: paidTo || null,
        date: new Date(date),
      })

      if (!uploadResult.success) {
        toast.error(uploadResult.error || 'Failed to upload file')
        setIsLoading(false)
        return
      }

      attachmentUrl = uploadResult.url || null
    }

    const data = {
      category,
      amount: amount,
      date: new Date(date),
      description: description || null,
      paidTo: paidTo || null,
      paymentMethod: paymentMethod || null,
      ...(attachmentUrl !== undefined && { attachmentUrl }),
    }

    const result = await updateExpense(expense.id, data)

    setIsLoading(false)

    if (result.success) {
      onOpenChange(false)
      toast.success('Expense updated successfully.')
      navigate(0)
    } else {
      toast.error(result.error || 'Something went wrong.')
    }
  }

  const expenseDate = expense.date
    ? new Date(expense.date).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Expense</DialogTitle>
            <DialogDescription>Update expense details.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-category">Category</Label>
              <Select value={category} onValueChange={setCategory} required>
                <SelectTrigger id="edit-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.name}>
                      {cat.displayName || cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-amount">Amount (₵)</Label>
              <Input
                id="edit-amount"
                name="amount"
                type="number"
                step="0.01"
                defaultValue={expense.amount}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-date">Date</Label>
              <Input id="edit-date" name="date" type="date" defaultValue={expenseDate} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-paidTo">Paid To *</Label>
              <Input
                id="edit-paidTo"
                name="paidTo"
                defaultValue={expense.paidTo || ''}
                placeholder="Who was this expense paid to?"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-paymentMethod">Payment Method *</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod} required>
                <SelectTrigger id="edit-paymentMethod">
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((method) => (
                    <SelectItem key={method.id} value={method.name}>
                      {method.displayName || method.name.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-attachment">Attachment (Optional)</Label>
              <Input
                id="edit-attachment"
                name="attachment"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              />
              {expense.attachmentUrl && (
                <p className="text-xs text-muted-foreground">
                  Current file:{' '}
                  <a
                    href={expense.attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    View
                  </a>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Upload a new receipt or supporting document (optional)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Note / Description</Label>
              <Textarea
                id="edit-description"
                name="description"
                defaultValue={expense.description || ''}
                placeholder="Additional information about this expense"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
