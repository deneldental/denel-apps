import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  createPaymentPlanTemplate,
  updatePaymentPlanTemplate,
} from '@/lib/actions/payment-plan-templates'
import type { paymentPlanTemplates } from '@/lib/db/schema'

type PaymentPlanTemplate = typeof paymentPlanTemplates.$inferSelect

interface PaymentPlanTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: PaymentPlanTemplate | null
  onSuccess?: () => void
}

export function PaymentPlanTemplateDialog({
  open,
  onOpenChange,
  template,
  onSuccess,
}: PaymentPlanTemplateDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    totalAmount: '',
    amountPerInstallment: '',
    paymentFrequency: 'monthly',
    isDefault: false,
    isActive: true,
    description: '',
  })

  useEffect(() => {
    if (template) {
      setFormData({
        name: template.name,
        totalAmount: Number((template.totalAmount / 100).toFixed(2)).toString(),
        amountPerInstallment: Number((template.amountPerInstallment / 100).toFixed(2)).toString(),
        paymentFrequency: template.paymentFrequency,
        isDefault: template.isDefault,
        isActive: template.isActive,
        description: template.description || '',
      })
    } else {
      setFormData({
        name: '',
        totalAmount: '',
        amountPerInstallment: '',
        paymentFrequency: 'monthly',
        isDefault: false,
        isActive: true,
        description: '',
      })
    }
  }, [template])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      if (!formData.name || !formData.totalAmount || !formData.amountPerInstallment) {
        toast.error('Please fill in all required fields')
        setIsLoading(false)
        return
      }

      const parsedTotal = parseFloat(formData.totalAmount)
      const parsedInstallment = parseFloat(formData.amountPerInstallment)

      if (
        !Number.isFinite(parsedTotal) ||
        parsedTotal <= 0 ||
        !Number.isFinite(parsedInstallment) ||
        parsedInstallment <= 0
      ) {
        toast.error('Amounts must be greater than zero')
        setIsLoading(false)
        return
      }

      if (parsedInstallment > parsedTotal) {
        toast.error('Amount per installment cannot be greater than total amount')
        setIsLoading(false)
        return
      }

      const totalAmount = Math.round(parsedTotal * 100)
      const amountPerInstallment = Math.round(parsedInstallment * 100)

      const data = {
        name: formData.name,
        totalAmount,
        amountPerInstallment,
        paymentFrequency: formData.paymentFrequency as 'weekly' | 'monthly' | 'biweekly' | 'custom',
        isDefault: formData.isDefault,
        isActive: formData.isActive,
        description: formData.description || undefined,
      }

      let result
      if (template) {
        result = await updatePaymentPlanTemplate(template.id, data)
      } else {
        result = await createPaymentPlanTemplate(data)
      }

      if (result.success) {
        toast.success(template ? 'Template updated successfully' : 'Template created successfully')
        onOpenChange(false)
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to save template')
      }
    } catch {
      toast.error('An error occurred while saving the template')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {template ? 'Edit Payment Plan Template' : 'Create Payment Plan Template'}
            </DialogTitle>
            <DialogDescription>
              {template
                ? 'Update the payment plan template details.'
                : 'Create a new payment plan template that can be assigned to patients.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Template Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Standard Ortho Plan"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="totalAmount">Total Amount (GHS) *</Label>
              <Input
                id="totalAmount"
                type="number"
                step="0.01"
                min="0"
                value={formData.totalAmount}
                onChange={(e) => setFormData({ ...formData, totalAmount: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amountPerInstallment">Amount per Installment (GHS) *</Label>
              <Input
                id="amountPerInstallment"
                type="number"
                step="0.01"
                min="0"
                value={formData.amountPerInstallment}
                onChange={(e) => setFormData({ ...formData, amountPerInstallment: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentFrequency">Payment Frequency *</Label>
              <Select
                value={formData.paymentFrequency}
                onValueChange={(value) => setFormData({ ...formData, paymentFrequency: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Biweekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Additional notes about this template"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isDefault"
                checked={formData.isDefault}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, isDefault: checked === true })
                }
              />
              <Label htmlFor="isDefault" className="cursor-pointer">
                Set as default template
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, isActive: checked === true })
                }
              />
              <Label htmlFor="isActive" className="cursor-pointer">
                Active (available for assignment)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {template ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
