import { ArrowLeft, Calendar, CreditCard, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TreatmentTypesMultiSelect } from '@/components/ui/treatment-types-multiselect'
import { updateAppointment } from '@/lib/actions/appointments'
import { getPaymentMethods } from '@/lib/actions/payment-methods'
import { getPaymentPlanByPatientId } from '@/lib/actions/payment-plans'
import { createPayment, getPaymentsByPatientId } from '@/lib/actions/payments'
import { getTreatmentTypes } from '@/lib/actions/treatment-types'
import { generatePaymentReceipt } from '@/lib/utils/receipt'

interface Appointment {
  id: string
  patientId: string
  doctorId: string
  date: Date | string
  type?: string
  notes?: string | null
  patient?: {
    name: string
    isOrtho?: boolean
  }
  [key: string]: unknown
}

interface CheckInPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: Appointment | null
  onSuccess?: () => void
}

export function CheckInPaymentDialog({
  open,
  onOpenChange,
  appointment,
  onSuccess,
}: CheckInPaymentDialogProps) {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [paymentType, setPaymentType] = useState<'one-time' | 'plan' | null>(null)
  const [paymentMethods, setPaymentMethods] = useState<
    Array<{ id: string; name: string; displayName: string | null }>
  >([])
  interface TreatmentType {
    id: string
    name: string
    displayName?: string | null
  }
  interface PaymentPlan {
    id: string
    totalAmount?: number
    totalAmountCents?: number
    [key: string]: unknown
  }
  const [treatmentTypesList, setTreatmentTypesList] = useState<TreatmentType[]>([])
  const [selectedTreatmentTypes, setSelectedTreatmentTypes] = useState<string[]>([])
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan | null>(null)
  const [outstandingBalance, setOutstandingBalance] = useState(0)

  const [formData, setFormData] = useState({
    amount: '',
    method: '',
    description: '',
    sendNotification: true,
  })

  const loadPatientPaymentPlan = useCallback(async () => {
    if (!appointment?.patientId) return

    const [planResult, paymentsResult] = await Promise.all([
      getPaymentPlanByPatientId(appointment.patientId),
      getPaymentsByPatientId(appointment.patientId),
    ])

    if (planResult.success && planResult.data) {
      const plan = planResult.data
      setPaymentPlan(plan)

      // Calculate outstanding balance
      const totalPaid =
        paymentsResult.success && paymentsResult.data
          ? paymentsResult.data
              .filter((p) => p.status === 'completed' && p.paymentPlanId === plan.id)
              .reduce((sum, p) => sum + (p.amount || 0), 0)
          : 0

      const outstanding = (plan.totalAmount || 0) - totalPaid
      setOutstandingBalance(outstanding)
    }
  }, [appointment?.patientId])

  const loadPaymentMethods = useCallback(async () => {
    const result = await getPaymentMethods()
    if (result.success && result.data) {
      setPaymentMethods(result.data)
      // Set default method to cash
      const cashMethod = result.data.find((m) => m.name === 'cash')
      setFormData((prev) => ({
        ...prev,
        method: cashMethod ? 'cash' : result.data![0]?.name || '',
      }))
    }
  }, [])

  const loadTreatmentTypes = useCallback(async () => {
    const result = await getTreatmentTypes()
    if (result.success && result.data) {
      setTreatmentTypesList(result.data)
    }
  }, [])

  useEffect(() => {
    if (open && appointment) {
      loadPaymentMethods()
      loadTreatmentTypes()

      // Check if patient is ortho
      if (appointment.patient?.isOrtho) {
        loadPatientPaymentPlan()
      }
    }
  }, [open, appointment, loadPatientPaymentPlan, loadTreatmentTypes, loadPaymentMethods])

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setPaymentType(null)
      setFormData({
        amount: '',
        method: '',
        description: '',
        sendNotification: true,
      })
      setSelectedTreatmentTypes([])
    }
  }, [open])

  const handleCheckInWithPayment = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!appointment) {
      toast.error('Appointment not found')
      return
    }

    if (!paymentType) {
      toast.error('Please select a payment type')
      return
    }

    if (!formData.method) {
      toast.error('Please select a payment method')
      return
    }

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    if (paymentType === 'one-time' && selectedTreatmentTypes.length === 0) {
      toast.error('Please select at least one service category')
      return
    }

    setIsLoading(true)

    try {
      // Convert amount to cents
      const amountInCents = parseFloat(formData.amount)

      // Build description
      let description =
        formData.description || `Payment for ${appointment.type || 'appointment'} appointment`

      // For one-time payments, try to get treatment type names for description
      if (paymentType === 'one-time' && selectedTreatmentTypes.length > 0) {
        // If we have treatment types loaded, use their names
        if (treatmentTypesList && treatmentTypesList.length > 0) {
          const selectedNames = treatmentTypesList
            .filter((type) => selectedTreatmentTypes.includes(type.id))
            .map((type) => type.displayName || type.name)

          if (selectedNames.length > 0) {
            description = selectedNames.join(', ')

            // Append additional notes if provided
            if (formData.description?.trim()) {
              description = `${description} - ${formData.description.trim()}`
            }
          }
        } else {
          // Fallback if treatment types aren't loaded yet
          description =
            formData.description ||
            `One-time payment for ${appointment.type || 'appointment'} appointment`
        }
      }

      // Create payment data
      interface PaymentData {
        patientId: string
        amount: number
        method: string
        description: string
        status: string
        sendNotification: boolean
        paymentPlanId?: string
      }
      const paymentData: PaymentData = {
        patientId: appointment.patientId,
        amount: amountInCents, // Use 'amount' not 'amountCents' - matches schema
        method: formData.method,
        description: description,
        status: 'completed',
        sendNotification: formData.sendNotification,
      }

      // Add payment plan ID if applicable
      if (paymentType === 'plan' && paymentPlan) {
        paymentData.paymentPlanId = paymentPlan.id
      }

      // Create the payment
      const paymentResult = await createPayment(paymentData)

      if (!paymentResult.success) {
        toast.error(paymentResult.error || 'Failed to process payment')
        setIsLoading(false)
        return
      }

      // Update appointment status to completed with check-in note
      const checkInNote = appointment.notes
        ? `${appointment.notes}\n\n[Checked in at ${new Date().toLocaleString()}]`
        : `[Checked in at ${new Date().toLocaleString()}]`

      const appointmentResult = await updateAppointment(appointment.id, {
        status: 'completed',
        notes: checkInNote,
      })

      if (!appointmentResult.success) {
        toast.error('Payment processed but failed to update appointment status')
        setIsLoading(false)
        return
      }

      // Create pending medical record entry for the doctor
      const { createPendingMedicalRecord } = await import('@/lib/actions/medical-records')
      try {
        await createPendingMedicalRecord({
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          appointmentId: appointment.id,
        })
      } catch (error) {
        console.error('Failed to create pending medical record:', error)
        // Don't fail the check-in if this fails, just log it
      }

      // Generate receipt if payment was successful
      if (paymentResult.data && appointment.patient?.name) {
        try {
          const planTotal =
            paymentType === 'plan' && paymentPlan
              ? typeof paymentPlan.totalAmountCents === 'number'
                ? paymentPlan.totalAmountCents
                : typeof paymentPlan.totalAmount === 'number'
                  ? paymentPlan.totalAmount
                  : undefined
              : undefined

          generatePaymentReceipt({
            patientName: appointment.patient.name,
            amountPaid: amountInCents,
            paymentMethod: formData.method,
            description: description,
            appointmentDate: new Date(), // Payment date (today)
            paymentType: paymentType,
            paymentPlanTotal: planTotal,
            paymentPlanBalance:
              paymentType === 'plan' && outstandingBalance > 0
                ? outstandingBalance - amountInCents
                : undefined,
            autoPrint: true,
          })
        } catch (error) {
          console.error('Failed to generate receipt:', error)
        }
      }

      toast.success('Patient checked in and payment processed successfully!')
      navigate(0)
      onSuccess?.()
      onOpenChange(false)
    } catch (error) {
      console.error('Error processing check-in payment:', error)
      toast.error('An error occurred while processing the payment')
    } finally {
      setIsLoading(false)
    }
  }

  if (!appointment) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Check In & Process Payment</DialogTitle>
          <DialogDescription>
            Check in {appointment.patient?.name} and process their payment
          </DialogDescription>
        </DialogHeader>

        {!paymentType ? (
          // Step 1: Choose payment type
          <div className="space-y-4 py-4">
            <Label>Select Payment Type</Label>
            <RadioGroup
              value={paymentType || ''}
              onValueChange={(value) => setPaymentType(value as 'one-time' | 'plan')}
              className="space-y-3"
            >
              <div className="flex items-center space-x-3 border rounded-lg p-4 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="one-time" id="one-time" />
                <Label htmlFor="one-time" className="flex items-center gap-2 cursor-pointer flex-1">
                  <CreditCard className="h-5 w-5" />
                  <div>
                    <div className="font-medium">One-Time Payment</div>
                    <div className="text-sm text-muted-foreground">Pay for specific treatments</div>
                  </div>
                </Label>
              </div>

              {appointment.patient?.isOrtho && (
                <div className="flex items-center space-x-3 border rounded-lg p-4 cursor-pointer hover:bg-accent">
                  <RadioGroupItem value="plan" id="plan" />
                  <Label htmlFor="plan" className="flex items-center gap-2 cursor-pointer flex-1">
                    <Calendar className="h-5 w-5" />
                    <div>
                      <div className="font-medium">Payment Plan</div>
                      <div className="text-sm text-muted-foreground">
                        {paymentPlan
                          ? `Outstanding: GH₵ ${outstandingBalance.toFixed(2)}`
                          : 'Installment payment'}
                      </div>
                    </div>
                  </Label>
                </div>
              )}
            </RadioGroup>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (paymentType) {
                    // Just move to payment form
                  } else {
                    toast.error('Please select a payment type')
                  }
                }}
                disabled={!paymentType}
              >
                Continue
              </Button>
            </div>
          </div>
        ) : (
          // Step 2: Payment form
          <form onSubmit={handleCheckInWithPayment} className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setPaymentType(null)}
                disabled={isLoading}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="text-sm font-medium">
                {paymentType === 'one-time' ? 'One-Time Payment' : 'Payment Plan'}
              </div>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (GHS) *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                required
              />
              {paymentType === 'plan' && outstandingBalance > 0 && (
                <p className="text-sm text-muted-foreground">
                  Outstanding balance: GH₵ {outstandingBalance.toFixed(2)}
                </p>
              )}
            </div>

            {/* Treatment Types (One-Time Only) */}
            {paymentType === 'one-time' && (
              <div className="space-y-2">
                <Label>Service Categories *</Label>
                <TreatmentTypesMultiSelect
                  value={selectedTreatmentTypes}
                  onChange={setSelectedTreatmentTypes}
                  placeholder="Select service categories..."
                />
              </div>
            )}

            {/* Payment Method */}
            <div className="space-y-2">
              <Label htmlFor="method">Payment Method *</Label>
              <Select
                value={formData.method}
                onValueChange={(value) => setFormData({ ...formData, method: value })}
                required
              >
                <SelectTrigger id="method">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((method) => (
                    <SelectItem key={method.id} value={method.name}>
                      {method.displayName || method.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Input
                id="description"
                placeholder="Add payment notes..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            {/* Send Notification */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="sendNotification"
                checked={formData.sendNotification}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, sendNotification: checked as boolean })
                }
              />
              <Label htmlFor="sendNotification" className="text-sm font-normal cursor-pointer">
                Send payment receipt via SMS
              </Label>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
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
                Check In & Pay
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
