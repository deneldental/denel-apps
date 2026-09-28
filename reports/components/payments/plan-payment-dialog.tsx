import { ArrowLeft, Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TreatmentTypesMultiSelect } from '@/components/ui/treatment-types-multiselect'
import { getPatients } from '@/lib/actions/patients'
import { getPaymentMethods } from '@/lib/actions/payment-methods'
import { getPaymentPlanByPatientId } from '@/lib/actions/payment-plans'
import { createPayment, getPaymentsByPatientId } from '@/lib/actions/payments'
import { getTreatmentTypes } from '@/lib/actions/treatment-types'
import type { patients, paymentPlans, treatmentTypes } from '@/lib/db/schema'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils/currency'
import { generatePaymentReceipt } from '@/lib/utils/receipt'

type Patient = typeof patients.$inferSelect
type PaymentPlan = typeof paymentPlans.$inferSelect
type TreatmentType = typeof treatmentTypes.$inferSelect

interface PlanPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function PlanPaymentDialog({ open, onOpenChange, onSuccess }: PlanPaymentDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [patientsList, setPatientsList] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan | null>(null)
  const [outstandingBalance, setOutstandingBalance] = useState(0)
  const [paymentMethods, setPaymentMethods] = useState<
    Array<{ id: string; name: string; displayName: string | null }>
  >([])
  const [patientComboboxOpen, setPatientComboboxOpen] = useState(false)
  const [formData, setFormData] = useState({
    patientId: '',
    amount: '',
    method: '',
    description: '',
    sendNotification: true,
  })
  const [selectedTreatmentTypes, setSelectedTreatmentTypes] = useState<string[]>([])
  const [treatmentTypesList, setTreatmentTypesList] = useState<TreatmentType[]>([])

  const loadTreatmentTypes = useCallback(async () => {
    const result = await getTreatmentTypes()
    if (result.success && result.data) {
      setTreatmentTypesList(result.data)
    }
  }, [])

  const loadPaymentMethods = useCallback(async () => {
    const result = await getPaymentMethods()
    if (result.success && result.data) {
      setPaymentMethods(result.data)
      // Set default method to first available or "cash" if it exists
      if (result.data.length > 0) {
        const cashMethod = result.data.find((m) => m.name === 'cash')
        setFormData((prev) => ({
          ...prev,
          method: cashMethod ? 'cash' : result.data![0].name,
        }))
      }
    }
  }, [])

  const loadPatients = useCallback(async () => {
    const result = await getPatients()
    if (result.success && result.data) {
      // Filter to only show ortho and legacy patients
      const allowedPatients = result.data.filter((p) => p.isOrtho || p.type === 'legacy')
      setPatientsList(allowedPatients)
    }
  }, [])

  const loadPatientPaymentPlan = useCallback(async () => {
    const patient = patientsList.find((p) => p.id === formData.patientId)
    if (!patient) return

    setSelectedPatient(patient)

    const [planResult, paymentsResult] = await Promise.all([
      getPaymentPlanByPatientId(patient.id),
      getPaymentsByPatientId(patient.id),
    ])

    if (planResult.success && planResult.data) {
      setPaymentPlan(planResult.data)

      // Calculate outstanding balance
      const completedPayments =
        paymentsResult.success && paymentsResult.data
          ? paymentsResult.data.filter(
              (p) => p.status === 'completed' && p.paymentPlanId === planResult.data?.id
            )
          : []
      const totalPaid = completedPayments.reduce((sum, p) => sum + p.amount, 0)
      const balance = planResult.data.totalAmount - totalPaid
      setOutstandingBalance(balance)
    } else {
      setPaymentPlan(null)
      setOutstandingBalance(0)
    }
  }, [patientsList, formData.patientId])

  useEffect(() => {
    if (open) {
      loadPatients()
      loadPaymentMethods()
      loadTreatmentTypes()
    }
  }, [open, loadPatients, loadTreatmentTypes, loadPaymentMethods])

  useEffect(() => {
    if (formData.patientId) {
      loadPatientPaymentPlan()
    } else {
      setSelectedPatient(null)
      setPaymentPlan(null)
      setOutstandingBalance(0)
    }
  }, [formData.patientId, loadPatientPaymentPlan])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      if (!formData.patientId) {
        toast.error('Please select a patient')
        setIsLoading(false)
        return
      }

      if (!paymentPlan) {
        toast.error('Selected patient does not have a payment plan')
        setIsLoading(false)
        return
      }

      if (!formData.amount || parseFloat(formData.amount) <= 0) {
        toast.error('Please enter a valid amount')
        setIsLoading(false)
        return
      }

      const amountInCents = parseFloat(formData.amount)
      if (amountInCents > outstandingBalance) {
        toast.error('Payment amount cannot exceed outstanding balance')
        setIsLoading(false)
        return
      }

      // Generate description from treatment types + custom notes
      let description = ''
      if (selectedTreatmentTypes.length > 0) {
        const selectedNames = treatmentTypesList
          .filter((type) => selectedTreatmentTypes.includes(type.id))
          .map((type) => type.displayName || type.name)
        description = selectedNames.join(', ')
      }

      if (formData.description.trim()) {
        description = description
          ? `${description} - ${formData.description.trim()}`
          : formData.description.trim()
      }

      const data = {
        patientId: formData.patientId,
        paymentPlanId: paymentPlan.id,
        amount: amountInCents,
        method: formData.method,
        status: 'completed' as const,
        description: description || null,
        sendNotification: formData.sendNotification ?? false,
      }

      const result = await createPayment(data)

      if (result.success) {
        if (result.smsError) {
          toast.warning(`Payment recorded, but SMS failed: ${result.smsError}`)
        } else {
          toast.success('Payment recorded successfully')
        }

        // Generate receipt
        try {
          if (selectedPatient && paymentPlan) {
            // Calculate new balance after payment
            const newBalance = outstandingBalance - amountInCents

            // Prioritize the description derived from this payment (treatments + notes)
            const receiptDescription =
              description || paymentPlan.notes || 'Payment Plan Installment'

            generatePaymentReceipt({
              patientName: selectedPatient.name,
              amountPaid: amountInCents,
              paymentMethod: formData.method,
              description: receiptDescription,
              paymentPlanTotal: paymentPlan.totalAmount,
              paymentPlanBalance: newBalance,
              paymentType: 'plan',
            })
          }
        } catch (error) {
          console.error('Failed to generate receipt:', error)
          // Don't fail the payment if receipt generation fails
        }

        onOpenChange(false)
        const defaultMethod =
          paymentMethods.find((m) => m.name === 'cash')?.name || paymentMethods[0]?.name || ''
        setFormData({
          patientId: '',
          amount: '',
          method: defaultMethod,
          description: '',
          sendNotification: true,
        })
        setSelectedPatient(null)
        setPaymentPlan(null)
        setOutstandingBalance(0)
        setSelectedTreatmentTypes([])
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to record payment')
      }
    } catch {
      toast.error('An error occurred while recording the payment')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Payment Plan Payment</DialogTitle>
            <DialogDescription>
              Record a payment towards a patient&apos;s payment plan.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="patient">Select Patient *</Label>
              <Popover open={patientComboboxOpen} onOpenChange={setPatientComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={patientComboboxOpen}
                    className="w-full justify-between"
                  >
                    {formData.patientId
                      ? (() => {
                          const patient = patientsList.find((p) => p.id === formData.patientId)
                          return patient
                            ? `${patient.name} ${patient.patientId ? `(${patient.patientId})` : ''}`
                            : 'Select a patient'
                        })()
                      : 'Select a patient'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0">
                  <Command>
                    <CommandInput placeholder="Search patients..." />
                    <CommandList>
                      <CommandEmpty>No patient found.</CommandEmpty>
                      <CommandGroup>
                        {patientsList.map((patient) => (
                          <CommandItem
                            key={patient.id}
                            value={`${patient.name} ${patient.patientId || ''}`}
                            onSelect={() => {
                              setFormData({ ...formData, patientId: patient.id })
                              setPatientComboboxOpen(false)
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                formData.patientId === patient.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            {patient.name} {patient.patientId && `(${patient.patientId})`}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {selectedPatient && paymentPlan && (
              <div className="rounded-lg border p-4 space-y-2 bg-muted/50">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total Amount:</span>
                    <p className="font-semibold">{formatCurrency(paymentPlan.totalAmount)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Outstanding Balance:</span>
                    <p className="font-semibold text-destructive">
                      {formatCurrency(outstandingBalance)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {selectedPatient && !paymentPlan && (
              <div className="rounded-lg border p-4 bg-yellow-50 dark:bg-yellow-900/20">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  This patient does not have an active payment plan.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="amount">Amount (GHS) *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                max={outstandingBalance}
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                required
                disabled={!paymentPlan}
              />
              {paymentPlan && outstandingBalance > 0 && (
                <p className="text-xs text-muted-foreground">
                  Maximum: {formatCurrency(outstandingBalance)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="method">Payment Method *</Label>
              <Select
                value={formData.method}
                onValueChange={(value) => setFormData({ ...formData, method: value })}
                required
              >
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
              <Label>Service Categories (Optional)</Label>
              <TreatmentTypesMultiSelect
                value={selectedTreatmentTypes}
                onChange={setSelectedTreatmentTypes}
                placeholder="Select service categories..."
              />
              <p className="text-xs text-muted-foreground">
                Select treatments to override the default receipt description.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Payment description"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="sendNotification"
                checked={formData.sendNotification}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, sendNotification: checked === true })
                }
              />
              <Label htmlFor="sendNotification" className="cursor-pointer">
                Send Payment Notification (SMS)
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
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button type="submit" disabled={isLoading || !paymentPlan}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
