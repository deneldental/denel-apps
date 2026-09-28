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
import { getPatient, getPatients } from '@/lib/actions/patients'
import { getPaymentMethods } from '@/lib/actions/payment-methods'
import { createPayment } from '@/lib/actions/payments'
import { getTreatmentTypes } from '@/lib/actions/treatment-types'
import type { patients, treatmentTypes } from '@/lib/db/schema'
import { cn } from '@/lib/utils'
import { generatePaymentReceipt } from '@/lib/utils/receipt'

type Patient = typeof patients.$inferSelect
type TreatmentType = typeof treatmentTypes.$inferSelect

interface OneTimePaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function OneTimePaymentDialog({ open, onOpenChange, onSuccess }: OneTimePaymentDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [patientsList, setPatientsList] = useState<Patient[]>([])
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
      setPatientsList(result.data)
    }
  }, [])

  useEffect(() => {
    if (open) {
      loadPatients()
      loadPaymentMethods()
      loadTreatmentTypes()
    }
  }, [open, loadTreatmentTypes, loadPaymentMethods, loadPatients])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      if (!formData.patientId) {
        toast.error('Please select a patient')
        setIsLoading(false)
        return
      }

      if (!formData.amount || parseFloat(formData.amount) <= 0) {
        toast.error('Please enter a valid amount')
        setIsLoading(false)
        return
      }

      if (selectedTreatmentTypes.length === 0) {
        toast.error('Please select at least one service category')
        setIsLoading(false)
        return
      }

      // Combine selected treatment types with custom description
      // Treatment types are required, so we always have at least one
      const selectedNames = treatmentTypesList
        .filter((type) => selectedTreatmentTypes.includes(type.id))
        .map((type) => type.displayName || type.name)
      let description = selectedNames.join(', ')

      // Append additional notes if provided
      if (formData.description.trim()) {
        description = `${description} - ${formData.description.trim()}`
      }

      const data = {
        patientId: formData.patientId,
        amount: parseFloat(formData.amount), // Store as is
        method: formData.method,
        status: 'completed' as const,
        description: description, // Always has treatment types, so never null
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
          const patientResult = await getPatient(formData.patientId)
          if (patientResult.success && patientResult.data) {
            generatePaymentReceipt({
              patientName: patientResult.data.name,
              amountPaid: data.amount,
              paymentMethod: formData.method,
              description: description, // Pass full description with treatment types
              paymentType: 'one-time',
            })
          }
        } catch {
          console.error('Failed to generate receipt')
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
            <DialogTitle>One-time Payment</DialogTitle>
            <DialogDescription>Record a one-time payment for a patient.</DialogDescription>
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

            <div className="space-y-2">
              <Label htmlFor="amount">Amount (GHS) *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                required
              />
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
              <Label>Service Categories *</Label>
              <TreatmentTypesMultiSelect
                value={selectedTreatmentTypes}
                onChange={setSelectedTreatmentTypes}
                placeholder="Select service categories..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Additional Notes (Optional)</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Additional payment notes"
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
            <Button type="submit" disabled={isLoading || selectedTreatmentTypes.length === 0}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
