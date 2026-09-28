import { Loader2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { createExpense } from '@/lib/actions/expenses'
import { getPaymentMethods } from '@/lib/actions/payment-methods'

interface AddExpenseDialogProps {
  buttonText?: string
}

export function AddExpenseDialog({ buttonText = 'Add Expense' }: AddExpenseDialogProps) {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [category, setCategory] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<string>('')
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string; displayName: string | null }>
  >([])
  const [paymentMethods, setPaymentMethods] = useState<
    Array<{ id: string; name: string; displayName: string | null }>
  >([])

  useEffect(() => {
    if (open) {
      // Load categories and payment methods when dialog opens
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

    let attachmentUrl: string | null = null

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

    interface ExpenseData {
      category: string
      amount: number
      description?: string | null
      date: Date
      paidTo?: string | null
      paymentMethod?: string | null
      attachmentUrl?: string | null
    }
    const data: ExpenseData = {
      category,
      amount: amount,
      date: new Date(date),
      description: description || null,
      paidTo: paidTo || null,
      paymentMethod: paymentMethod || null,
      attachmentUrl,
    }

    const result = await createExpense(data)

    setIsLoading(false)

    if (result.success) {
      setOpen(false)
      // Reset form if it still exists
      try {
        const form = event.currentTarget
        if (form) {
          form.reset()
        }
      } catch {
        // Form might have been unmounted, ignore
      }
      setCategory('')
      setPaymentMethod('')
      toast.success('Expense created successfully.')
    } else {
      toast.error(result.error || 'Something went wrong.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen)
        if (!newOpen) {
          // Reset form when dialog closes
          setCategory('')
          setPaymentMethod('')
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          {buttonText}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
            <DialogDescription>Record a new expense for the clinic.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select value={category} onValueChange={setCategory} required>
                <SelectTrigger>
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
              <Label htmlFor="amount">Amount (₵)</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                name="date"
                type="date"
                defaultValue={new Date().toISOString().split('T')[0]}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paidTo">Paid To *</Label>
              <Input
                id="paidTo"
                name="paidTo"
                placeholder="Who was this expense paid to?"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Payment Method *</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod} required>
                <SelectTrigger>
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
              <Label htmlFor="attachment">Attachment (Optional)</Label>
              <Input
                id="attachment"
                name="attachment"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              />
              <p className="text-xs text-muted-foreground">
                Upload a receipt or supporting document
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Note / Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Additional information about this expense"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Expense
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
