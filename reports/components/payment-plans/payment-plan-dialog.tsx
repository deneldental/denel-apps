import { Loader2, Pencil, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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
import { TreatmentTypesMultiSelect } from '@/components/ui/treatment-types-multiselect'
import {
  getDefaultPaymentPlanTemplate,
  getPaymentPlanTemplates,
} from '@/lib/actions/payment-plan-templates'
import { createPaymentPlan, updatePaymentPlan } from '@/lib/actions/payment-plans'
import { getTreatmentTypes } from '@/lib/actions/treatment-types'
import type { paymentPlans, paymentPlanTemplates, treatmentTypes } from '@/lib/db/schema'
import { centsToInput, formatCurrency, inputToCents } from '@/lib/utils/currency'

type PaymentPlan = typeof paymentPlans.$inferSelect
type PaymentPlanTemplate = typeof paymentPlanTemplates.$inferSelect
type TreatmentType = typeof treatmentTypes.$inferSelect

interface PaymentPlanDialogProps {
  patientId: string
  existingPlan?: PaymentPlan | null
  onSuccess?: () => void
  isAdmin?: boolean
}

export function PaymentPlanDialog({
  patientId,
  existingPlan,
  onSuccess,
  isAdmin = false,
}: PaymentPlanDialogProps) {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [templates, setTemplates] = useState<PaymentPlanTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [selectedTemplate, setSelectedTemplate] = useState<PaymentPlanTemplate | null>(null)
  const [selectedTreatmentTypes, setSelectedTreatmentTypes] = useState<string[]>([])
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [treatmentTypesList, setTreatmentTypesList] = useState<TreatmentType[]>([])
  const [planType, setPlanType] = useState<'fixed' | 'flexible'>('fixed')
  const [flexibleTotalAmount, setFlexibleTotalAmount] = useState<string>('')

  const loadTemplates = useCallback(async () => {
    const result = await getPaymentPlanTemplates()
    if (result.success && result.data) {
      const activeTemplates = result.data.filter((t) => t.isActive)
      setTemplates(activeTemplates)

      // If no existing plan, try to set default template
      if (!existingPlan && activeTemplates.length > 0) {
        const defaultResult = await getDefaultPaymentPlanTemplate()
        if (defaultResult.success && defaultResult.data) {
          setSelectedTemplateId(defaultResult.data.id)
          setSelectedTemplate(defaultResult.data)
        } else if (activeTemplates.length > 0) {
          // Use first template if no default
          setSelectedTemplateId(activeTemplates[0].id)
          setSelectedTemplate(activeTemplates[0])
        }
      } else if (existingPlan?.templateId) {
        const template = activeTemplates.find((t) => t.id === existingPlan.templateId)
        if (template) {
          setSelectedTemplate(template)
        }
      }
    }
  }, [existingPlan])

  const loadTreatmentTypes = async () => {
    const result = await getTreatmentTypes()
    if (result.success && result.data) {
      setTreatmentTypesList(result.data)
    }
  }

  useEffect(() => {
    if (open) {
      loadTemplates()
      loadTreatmentTypes()
      if (existingPlan?.templateId) {
        setSelectedTemplateId(existingPlan.templateId)
      }
      setAdditionalNotes(existingPlan?.notes || '')
      // Parse existing notes to extract treatment types if stored
      // For now, we'll start fresh. In future, we can parse existing notes
      setSelectedTreatmentTypes([])
      setAdditionalNotes('')
      setPlanType(existingPlan?.type === 'flexible' ? 'flexible' : 'fixed')
      setFlexibleTotalAmount(
        existingPlan?.totalAmount ? centsToInput(existingPlan.totalAmount) : ''
      )
    }
  }, [open, existingPlan, loadTemplates, loadTreatmentTypes])

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId)
    const template = templates.find((t) => t.id === templateId)
    setSelectedTemplate(template || null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      // Validate based on plan type
      if (planType === 'fixed' && !selectedTemplate) {
        toast.error('Please select a payment plan template')
        setIsLoading(false)
        return
      }

      const flexibleCents = inputToCents(flexibleTotalAmount)
      if (planType === 'flexible' && flexibleCents <= 0) {
        toast.error('Please enter a valid total amount')
        setIsLoading(false)
        return
      }

      if (selectedTreatmentTypes.length === 0) {
        toast.error('Please select at least one service category')
        setIsLoading(false)
        return
      }

      // Combine selected treatment types with additional notes
      // Treatment types are required, so we always have at least one
      const selectedNames = treatmentTypesList
        .filter((type) => selectedTreatmentTypes.includes(type.id))
        .map((type) => type.displayName || type.name)
      let notesText = selectedNames.join(', ')

      // Append additional notes if provided
      if (additionalNotes.trim()) {
        notesText = `${notesText} - ${additionalNotes.trim()}`
      }

      const data = {
        patientId,
        type: planType,
        templateId: planType === 'fixed' ? selectedTemplate?.id : undefined,
        totalAmount: planType === 'fixed' ? (selectedTemplate?.totalAmount ?? 0) : flexibleCents,
        amountPerInstallment:
          planType === 'fixed' ? selectedTemplate?.amountPerInstallment : undefined,
        paymentFrequency:
          planType === 'fixed'
            ? (selectedTemplate?.paymentFrequency as 'weekly' | 'monthly' | 'biweekly' | 'custom')
            : undefined,
        startDate: new Date(), // Automatic start date
        status: planType === 'flexible' ? ('outstanding' as const) : ('activated' as const),
        notes: notesText, // Always has treatment types, so never undefined
      }

      let result
      if (existingPlan) {
        // Build notes for update
        // Treatment types are required, so we always have at least one
        const selectedNames = treatmentTypesList
          .filter((type) => selectedTreatmentTypes.includes(type.id))
          .map((type) => type.displayName || type.name)
        let updateNotesText = selectedNames.join(', ')

        if (additionalNotes.trim()) {
          updateNotesText = `${updateNotesText} - ${additionalNotes.trim()}`
        }

        result = await updatePaymentPlan(existingPlan.id, {
          type: planType,
          templateId: planType === 'fixed' ? selectedTemplate?.id : undefined,
          totalAmount: planType === 'fixed' ? selectedTemplate?.totalAmount : flexibleCents,
          amountPerInstallment:
            planType === 'fixed' ? selectedTemplate?.amountPerInstallment : undefined,
          paymentFrequency: planType === 'fixed' ? selectedTemplate?.paymentFrequency : undefined,
          notes: updateNotesText, // Always has treatment types, so never undefined
        })
      } else {
        result = await createPaymentPlan(data)
      }

      if (result.success) {
        toast.success(
          existingPlan ? 'Payment plan updated successfully' : 'Payment plan created successfully'
        )
        setOpen(false)
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to save payment plan')
      }
    } catch {
      toast.error('An error occurred while saving the payment plan')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={existingPlan ? 'outline' : 'default'}
          disabled={!!existingPlan && !isAdmin}
        >
          {existingPlan ? (
            isAdmin ? (
              <>
                <Pencil className="mr-2 h-4 w-4" />
                Change Payment Plan (Admin Only)
              </>
            ) : (
              <>
                <Pencil className="mr-2 h-4 w-4" />
                View Payment Plan
              </>
            )
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Select Payment Plan
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {existingPlan
                ? isAdmin
                  ? 'Change Payment Plan (Admin Only)'
                  : 'Payment Plan Details'
                : 'Select Payment Plan'}
            </DialogTitle>
            <DialogDescription>
              {existingPlan
                ? isAdmin
                  ? 'Only administrators can change the payment plan once it has been selected.'
                  : 'This payment plan has been locked. Only administrators can make changes.'
                : 'Select a payment plan template to assign to this patient. Once selected, only administrators can change it.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-3">
              <Label>Plan Type *</Label>
              <div className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="fixed"
                    name="planType"
                    value="fixed"
                    checked={planType === 'fixed'}
                    onChange={() => setPlanType('fixed')}
                    disabled={!!existingPlan && !isAdmin}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="fixed" className="font-normal cursor-pointer">
                    Fixed Schedule
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="flexible"
                    name="planType"
                    value="flexible"
                    checked={planType === 'flexible'}
                    onChange={() => setPlanType('flexible')}
                    disabled={!!existingPlan && !isAdmin}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="flexible" className="font-normal cursor-pointer">
                    Flexible Installments
                  </Label>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {planType === 'fixed'
                  ? 'Fixed schedule with regular installments'
                  : 'Flexible payments without fixed schedule'}
              </p>
            </div>

            {planType === 'fixed' && (
              <div className="space-y-2">
                <Label htmlFor="template">Payment Plan Template *</Label>
                <Select
                  value={selectedTemplateId}
                  onValueChange={handleTemplateChange}
                  required
                  disabled={!!existingPlan && !isAdmin}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name} {template.isDefault && '(Default)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {existingPlan && !isAdmin && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Payment plan is locked. Contact an administrator to make changes.
                  </p>
                )}
              </div>
            )}

            {planType === 'flexible' && (
              <div className="space-y-2">
                <Label htmlFor="flexibleAmount">Total Amount *</Label>
                <Input
                  id="flexibleAmount"
                  type="text"
                  inputMode="decimal"
                  placeholder="Enter total amount (e.g., 2000)"
                  value={flexibleTotalAmount}
                  onChange={(e) => {
                    // Only allow numbers and decimal point
                    const value = e.target.value.replace(/[^\d.]/g, '')
                    setFlexibleTotalAmount(value)
                  }}
                  disabled={!!existingPlan && !isAdmin}
                  required
                />
                <p className="text-sm text-muted-foreground">
                  Enter the total amount exactly as needed (e.g., 2000 for GHS 2,000.00)
                </p>
              </div>
            )}

            {selectedTemplate && planType === 'fixed' && (
              <div className="rounded-lg border p-4 space-y-2 bg-muted/50">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total Amount:</span>
                    <p className="font-semibold">{formatCurrency(selectedTemplate.totalAmount)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Per Installment:</span>
                    <p className="font-semibold">
                      {formatCurrency(selectedTemplate.amountPerInstallment)}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Frequency:</span>
                    <p className="capitalize">{selectedTemplate.paymentFrequency}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Start Date:</span>
                    <p>{new Date().toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Service Categories *</Label>
              <TreatmentTypesMultiSelect
                value={selectedTreatmentTypes}
                onChange={setSelectedTreatmentTypes}
                placeholder="Select service categories..."
                disabled={!!existingPlan && !isAdmin}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="additionalNotes">Additional Notes (Optional)</Label>
              <Textarea
                id="additionalNotes"
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder="Additional notes about this payment plan"
                disabled={!!existingPlan && !isAdmin}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isLoading ||
                (planType === 'fixed' && !selectedTemplate) ||
                (planType === 'flexible' && !flexibleTotalAmount) ||
                selectedTreatmentTypes.length === 0 ||
                (!!existingPlan && !isAdmin)
              }
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {existingPlan ? (isAdmin ? 'Change Plan' : 'Locked') : 'Select Plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
