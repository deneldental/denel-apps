import { format } from 'date-fns'
import { Eye, Loader2, MoreHorizontal, Pause, Pencil, Play, Printer, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { EditMedicalRecordDialog } from '@/components/medical-records/edit-medical-record-dialog'
import { ViewMedicalRecordDialog } from '@/components/medical-records/view-medical-record-dialog'
import { EditPatientDialog } from '@/components/patients/edit-patient-dialog'
import { PaymentPlanDialog } from '@/components/payment-plans/payment-plan-dialog'
import { ReceiptViewDialog } from '@/components/payments/receipt-view-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmationDialog } from '@/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { deleteMedicalRecord } from '@/lib/actions/medical-records'
import { updatePatient } from '@/lib/actions/patients'
import {
  getPaymentPlanByPatientId,
  pausePaymentPlan,
  unpausePaymentPlan,
  updatePaymentAmount,
} from '@/lib/actions/payment-plans'
import { getPaymentsByPatientId } from '@/lib/actions/payments'
import type { patients, paymentPlans } from '@/lib/db/schema'
import { generatePaymentReceipt } from '@/lib/utils/receipt'

type Patient = typeof patients.$inferSelect
type PaymentPlan = typeof paymentPlans.$inferSelect

interface EditableFieldProps {
  label: string
  value: string | null | undefined
  onSave: (value: string) => Promise<void>
  type?: 'text' | 'email' | 'tel' | 'date' | 'textarea' | 'select'
  options?: { value: string; label: string }[]
  placeholder?: string
  className?: string
}

function EditableField({
  label,
  value,
  onSave,
  type = 'text',
  options,
  placeholder,
  className = '',
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value || '')
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    setEditValue(value || '')
  }, [value])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      if (type === 'text' || type === 'email' || type === 'tel') {
        ;(inputRef.current as HTMLInputElement).select()
      }
    }
  }, [isEditing, type])

  const handleSave = async () => {
    if (editValue === (value || '')) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      await onSave(editValue)
      setIsEditing(false)
    } catch {
      // Error handling is done in onSave
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditValue(value || '')
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (isEditing) {
    return (
      <div className={className}>
        <p className="text-sm font-medium text-muted-foreground mb-1">{label}</p>
        <div className="flex items-center gap-2">
          {type === 'textarea' ? (
            <Textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex-1"
              disabled={isSaving}
            />
          ) : type === 'select' && options ? (
            <Select
              value={editValue}
              onValueChange={async (val) => {
                setEditValue(val)
                setIsSaving(true)
                try {
                  await onSave(val)
                  setIsEditing(false)
                } catch {
                  // Error handling is done in onSave
                } finally {
                  setIsSaving(false)
                }
              }}
              disabled={isSaving}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type={type}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex-1"
              disabled={isSaving}
            />
          )}
          {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`cursor-pointer hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors ${className}`}
      onClick={() => setIsEditing(true)}
    >
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="font-medium">{value || '-'}</p>
    </div>
  )
}

interface PatientDetailContentProps {
  patient: Patient
  medicalRecords: Array<{
    id: string
    date: Date | string
    createdAt: Date | string
    [key: string]: unknown
  }>
  payments: Array<{
    id: string
    amount: number
    [key: string]: unknown
  }>
  paymentPlan: PaymentPlan | null
  isAdmin?: boolean
  canViewMedicalRecords?: boolean
  canEdit?: boolean
}

export function PatientDetailContent({
  patient: initialPatient,
  medicalRecords,
  payments,
  paymentPlan: initialPaymentPlan,
  isAdmin = false,
  canViewMedicalRecords = false,
  canEdit = true,
}: PatientDetailContentProps) {
  const navigate = useNavigate()
  const [patient, setPatient] = useState(initialPatient)
  const [paymentPlan, setPaymentPlan] = useState(initialPaymentPlan)

  const oneTimePayments = payments.filter((p) => !p.paymentPlanId)
  const planPayments = payments.filter((p) => p.paymentPlanId)

  interface MedicalRecord {
    id: string
    date?: Date | string
    createdAt: Date | string
    [key: string]: unknown
  }
  interface ReceiptData {
    patientName: string
    appointmentDate?: string
    amountPaid: number
    totalAmount?: number
    balance?: number
    paymentType: string
    paymentFor: string
    notes?: string | null
    clinicName: string
    clinicPhone?: string | null
    clinicAddress?: string | null
    generatedAt: string
  }
  const [selectedMedicalRecord, setSelectedMedicalRecord] = useState<MedicalRecord | null>(null)
  const [showViewMedicalRecord, setShowViewMedicalRecord] = useState(false)
  const [showEditMedicalRecord, setShowEditMedicalRecord] = useState(false)
  const [showDeleteMedicalRecord, setShowDeleteMedicalRecord] = useState(false)
  const [showReceiptDialog, setShowReceiptDialog] = useState(false)
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [isDeletingMedicalRecord, setIsDeletingMedicalRecord] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)

  // Edit Payment State
  const [editingPayment, setEditingPayment] = useState<{ id: string; amount: number } | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [updatingPayment, setUpdatingPayment] = useState(false)

  const handleFieldUpdate = async (field: keyof Patient, value: string) => {
    try {
      let processedValue: string | Date | boolean = value

      // Handle date fields
      if (field === 'dob' && value) {
        processedValue = new Date(value)
      }

      // Handle boolean fields
      if (field === 'isChild' || field === 'isOrtho') {
        processedValue = value === 'true' || value === '1'
      }

      const result = await updatePatient(patient.id, {
        [field]: processedValue,
      })

      if (result.success) {
        setPatient((prev) => ({
          ...prev,
          [field]: processedValue,
        }))
        toast.success('Patient updated successfully')
        navigate(0)
      } else {
        toast.error(result.error || 'Failed to update patient')
        throw new Error(result.error || 'Failed to update patient')
      }
    } catch {
      // Error already handled in toast
    }
  }

  const handlePaymentPlanSuccess = async () => {
    // Refresh payment plan data
    if (patient.id) {
      const planResult = await getPaymentPlanByPatientId(patient.id)
      if (planResult.success && planResult.data) {
        setPaymentPlan(planResult.data)
      }
    }
    navigate(0)
  }

  const handleViewMedicalRecord = (record: MedicalRecord) => {
    setSelectedMedicalRecord(record)
    setShowViewMedicalRecord(true)
  }

  const handleEditMedicalRecord = (record: MedicalRecord) => {
    setSelectedMedicalRecord(record)
    setShowEditMedicalRecord(true)
  }

  const handleDeleteMedicalRecord = async () => {
    if (!selectedMedicalRecord) return
    setIsDeletingMedicalRecord(true)
    try {
      const result = await deleteMedicalRecord(selectedMedicalRecord.id)
      if (result.success) {
        toast.success('Medical record deleted successfully')
        setShowDeleteMedicalRecord(false)
        setSelectedMedicalRecord(null)
        navigate(0)
      } else {
        toast.error(result.error || 'Failed to delete medical record')
      }
    } catch {
      toast.error('An error occurred while deleting the medical record')
    } finally {
      setIsDeletingMedicalRecord(false)
    }
  }

  const handleEditPayment = (payment: { id: string; amount: number }) => {
    setEditingPayment(payment)
    setEditAmount(payment.amount.toString()) // Amount is already in GHS
  }

  const handleUpdatePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingPayment) return

    setUpdatingPayment(true)
    try {
      const amount = parseFloat(editAmount)
      if (Number.isNaN(amount) || amount <= 0) {
        toast.error('Please enter a valid amount')
        return
      }

      const result = await updatePaymentAmount(editingPayment.id, amount)
      if (result.success) {
        toast.success(result.message)
        setEditingPayment(null)
        navigate(0)
      } else {
        toast.error(result.error || 'Failed to update payment amount')
      }
    } catch (_error) {
      toast.error('An error occurred while updating the payment')
    } finally {
      setUpdatingPayment(false)
    }
  }

  interface PaymentForReceipt {
    id: string
    amount: number
    method?: unknown
    description?: unknown
    createdAt?: unknown
    paymentPlanId?: unknown
    patientId?: string
    balance?: number
    patient?: {
      name?: string
    }
    [key: string]: unknown
  }
  const preparePaymentReceiptData = async (payment: PaymentForReceipt) => {
    // Use patient from props if payment doesn't have patient relation
    const paymentPatient = payment.patient as { name?: string } | undefined
    const patientName = paymentPatient?.name || patient.name
    if (!patientName) {
      toast.error('Patient information not available')
      return null
    }

    let paymentPlanTotal: number | undefined
    let paymentPlanBalance: number | undefined

    // If it's a plan payment, use stored balance or calculate it
    if (payment.paymentPlanId && payment.patientId) {
      // Use stored balance if available (for older receipts)
      if (payment.balance !== null && payment.balance !== undefined) {
        paymentPlanBalance = payment.balance

        // Still need total amount for display
        const planResult = await getPaymentPlanByPatientId(payment.patientId)
        if (planResult.success && planResult.data) {
          paymentPlanTotal = planResult.data.totalAmount
        }
      } else {
        // Calculate balance for newer payments without stored balance
        const [planResult, paymentsResult] = await Promise.all([
          getPaymentPlanByPatientId(payment.patientId),
          getPaymentsByPatientId(payment.patientId),
        ])

        if (planResult.success && planResult.data) {
          paymentPlanTotal = planResult.data.totalAmount

          // Calculate balance: total - all completed payments for this plan (including current payment)
          const completedPayments = paymentsResult.success
            ? paymentsResult.data.filter(
                (p) => p.status === 'completed' && p.paymentPlanId === planResult.data?.id
              )
            : []
          const totalPaid = completedPayments.reduce((sum, p) => sum + p.amount, 0)
          // Balance after all payments including this one
          paymentPlanBalance = planResult.data.totalAmount - totalPaid
        }
      }
    }

    // Format appointment date
    let formattedAppointmentDate: string | undefined
    if (payment.createdAt) {
      try {
        const createdAt = payment.createdAt
        let date: Date
        if (typeof createdAt === 'string') {
          date = new Date(createdAt)
        } else if (createdAt instanceof Date) {
          date = createdAt
        } else {
          date = new Date()
        }
        formattedAppointmentDate = format(date, 'MMMM d, yyyy h:mm a')
      } catch {
        formattedAppointmentDate = undefined
      }
    }

    // Convert cents to GHS
    const amountPaidGHS = payment.amount
    const totalAmountGHS = paymentPlanTotal ? paymentPlanTotal : undefined
    const balanceGHS = paymentPlanBalance !== undefined ? paymentPlanBalance : undefined

    return {
      patientName: patientName,
      appointmentDate: formattedAppointmentDate,
      amountPaid: amountPaidGHS,
      totalAmount: totalAmountGHS,
      balance: balanceGHS,
      paymentType: typeof payment.method === 'string' ? payment.method : 'unknown',
      paymentFor: payment.paymentPlanId
        ? 'Ortho Payment'
        : typeof payment.description === 'string'
          ? payment.description
          : 'Service Payment',
      notes: typeof payment.description === 'string' ? payment.description : null,
      clinicName: import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic',
      clinicPhone: import.meta.env.VITE_CLINIC_PHONE || null,
      clinicAddress: import.meta.env.VITE_CLINIC_ADDRESS || null,
      generatedAt: new Date().toLocaleString(),
    }
  }

  const handleViewReceipt = async (payment: PaymentForReceipt) => {
    try {
      const data = await preparePaymentReceiptData(payment)
      if (data) {
        setReceiptData(data)
        setShowReceiptDialog(true)
      }
    } catch (error: unknown) {
      console.error('Failed to prepare receipt:', error)
      toast.error('Failed to load receipt')
    }
  }

  const handlePrintReceipt = async (payment: PaymentForReceipt) => {
    try {
      // Use patient from props if payment doesn't have patient relation
      const paymentPatient = payment.patient as { name?: string } | undefined
      const patientName = paymentPatient?.name || patient.name
      if (!patientName) {
        toast.error('Patient information not available')
        return
      }

      let paymentPlanTotal: number | undefined
      let paymentPlanBalance: number | undefined

      // If it's a plan payment, use stored balance or calculate it
      const paymentPlanId = payment.paymentPlanId
      const patientId = typeof payment.patientId === 'string' ? payment.patientId : undefined

      if (paymentPlanId && patientId && typeof patientId === 'string') {
        // Use stored balance if available (for older receipts)
        const balance = payment.balance
        if (balance !== null && balance !== undefined && typeof balance === 'number') {
          paymentPlanBalance = balance

          // Still need total amount for display
          const planResult = await getPaymentPlanByPatientId(patientId)
          if (planResult.success && planResult.data) {
            paymentPlanTotal = planResult.data.totalAmount
          }
        } else {
          // Calculate balance for newer payments without stored balance
          const [planResult, paymentsResult] = await Promise.all([
            getPaymentPlanByPatientId(patientId),
            getPaymentsByPatientId(patientId),
          ])

          if (planResult.success && planResult.data) {
            paymentPlanTotal = planResult.data.totalAmount

            // Calculate balance: total - all completed payments for this plan (including current payment)
            const completedPayments = paymentsResult.success
              ? paymentsResult.data.filter(
                  (p) => p.status === 'completed' && p.paymentPlanId === planResult.data?.id
                )
              : []
            const totalPaid = completedPayments.reduce((sum, p) => sum + p.amount, 0)
            // Balance after all payments including this one
            paymentPlanBalance = planResult.data.totalAmount - totalPaid
          }
        }
      }

      const paymentMethod = typeof payment.method === 'string' ? payment.method : 'unknown'
      const description = typeof payment.description === 'string' ? payment.description : undefined
      const createdAt = payment.createdAt
      const appointmentDate =
        createdAt instanceof Date || typeof createdAt === 'string'
          ? createdAt instanceof Date
            ? createdAt
            : new Date(createdAt)
          : undefined

      generatePaymentReceipt({
        patientName: patientName,
        amountPaid: payment.amount,
        paymentMethod: paymentMethod,
        description: description || undefined,
        appointmentDate: appointmentDate || undefined,
        paymentPlanTotal: paymentPlanTotal,
        paymentPlanBalance: paymentPlanBalance,
        paymentType: paymentPlanId ? 'plan' : 'one-time',
        autoPrint: true,
      })
    } catch (error: unknown) {
      console.error('Failed to generate receipt:', error)
      toast.error('Failed to generate receipt')
    }
  }

  const dob = patient.dob ? new Date(patient.dob) : null
  const now = new Date()
  const age = dob
    ? Math.floor((now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null
  const dobString = dob ? dob.toISOString().split('T')[0] : ''

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'GHS',
    }).format(amount)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumbs */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/patient-records">Patients</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{patient.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Patient Header */}
      <div className="flex items-start gap-6">
        <Avatar className="h-24 w-24">
          {patient.profileImage ? (
            <AvatarImage src={patient.profileImage} alt={patient.name} />
          ) : (
            <AvatarFallback className="text-2xl">
              {patient.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          )}
        </Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <EditableField
              label=""
              value={patient.name}
              onSave={(val) => handleFieldUpdate('name', val)}
              type="text"
              className="text-3xl font-bold tracking-tight"
            />
            {patient.isChild && <Badge variant="secondary">Child</Badge>}
            {patient.isOrtho && <Badge variant="outline">Ortho</Badge>}
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setShowEditDialog(true)}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit Profile
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Patient ID:{' '}
              <span className="text-muted-foreground">{patient.patientId || 'Not assigned'}</span>
            </p>
            <p className="text-muted-foreground">
              {patient.email || 'No email'} • {patient.phone || 'No phone'}
            </p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="personal" className="w-full">
        <TabsList>
          <TabsTrigger value="personal">Personal Info</TabsTrigger>
          {canViewMedicalRecords && <TabsTrigger value="medical">Medical Records</TabsTrigger>}
          <TabsTrigger value="payments">Payment Records</TabsTrigger>
        </TabsList>

        {/* Personal Info Tab */}
        <TabsContent value="personal" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
                <CardDescription>Basic patient details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Patient ID</p>
                    <p className="font-medium">{patient.patientId || 'Not assigned'}</p>
                  </div>
                  <EditableField
                    label="Gender"
                    value={patient.gender}
                    onSave={(val) => handleFieldUpdate('gender', val)}
                    type="select"
                    options={[
                      { value: 'male', label: 'Male' },
                      { value: 'female', label: 'Female' },
                    ]}
                  />
                  <EditableField
                    label="Date of Birth"
                    value={dobString}
                    onSave={(val) => handleFieldUpdate('dob', val)}
                    type="date"
                  />
                  {age && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Age</p>
                      <p>{age} years</p>
                    </div>
                  )}
                  {patient.occupation && (
                    <EditableField
                      label="Occupation"
                      value={patient.occupation}
                      onSave={(val) => handleFieldUpdate('occupation', val)}
                      type="text"
                    />
                  )}
                  <EditableField
                    label="Nationality"
                    value={patient.nationality || 'Ghana'}
                    onSave={(val) => handleFieldUpdate('nationality', val)}
                    type="text"
                  />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Joined At</p>
                    <p>
                      {patient.createdAt
                        ? format(new Date(patient.createdAt), 'MMMM d, yyyy')
                        : 'Unknown'}
                    </p>
                  </div>
                </div>
                {patient.address && (
                  <EditableField
                    label="Address"
                    value={patient.address}
                    onSave={(val) => handleFieldUpdate('address', val)}
                    type="textarea"
                  />
                )}
              </CardContent>
            </Card>

            {patient.isChild ? (
              <Card>
                <CardHeader>
                  <CardTitle>Guardian/Parent Information</CardTitle>
                  <CardDescription>Contact details for guardian</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {patient.guardianName && (
                      <EditableField
                        label="Name"
                        value={patient.guardianName}
                        onSave={(val) => handleFieldUpdate('guardianName', val)}
                        type="text"
                      />
                    )}
                    {patient.guardianPhone && (
                      <EditableField
                        label="Phone"
                        value={patient.guardianPhone}
                        onSave={(val) => handleFieldUpdate('guardianPhone', val)}
                        type="tel"
                      />
                    )}
                    {patient.guardianEmail && (
                      <EditableField
                        label="Email"
                        value={patient.guardianEmail}
                        onSave={(val) => handleFieldUpdate('guardianEmail', val)}
                        type="email"
                      />
                    )}
                    {patient.guardianOccupation && (
                      <EditableField
                        label="Occupation"
                        value={patient.guardianOccupation}
                        onSave={(val) => handleFieldUpdate('guardianOccupation', val)}
                        type="text"
                      />
                    )}
                  </div>
                  {patient.guardianAddress && (
                    <EditableField
                      label="Address"
                      value={patient.guardianAddress}
                      onSave={(val) => handleFieldUpdate('guardianAddress', val)}
                      type="textarea"
                    />
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Contact Information</CardTitle>
                  <CardDescription>Patient contact details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {patient.email && (
                    <EditableField
                      label="Email"
                      value={patient.email}
                      onSave={(val) => handleFieldUpdate('email', val)}
                      type="email"
                    />
                  )}
                  {patient.phone && (
                    <EditableField
                      label="Phone"
                      value={patient.phone}
                      onSave={(val) => handleFieldUpdate('phone', val)}
                      type="tel"
                    />
                  )}
                </CardContent>
              </Card>
            )}

            {(patient.insuranceProvider ||
              patient.insurancePolicyNumber ||
              patient.emergencyContactName) && (
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>Additional Information</CardTitle>
                  <CardDescription>Insurance and emergency contacts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {patient.insuranceProvider && (
                      <EditableField
                        label="Insurance Provider"
                        value={patient.insuranceProvider}
                        onSave={(val) => handleFieldUpdate('insuranceProvider', val)}
                        type="text"
                      />
                    )}
                    {patient.insurancePolicyNumber && (
                      <EditableField
                        label="Policy Number"
                        value={patient.insurancePolicyNumber}
                        onSave={(val) => handleFieldUpdate('insurancePolicyNumber', val)}
                        type="text"
                      />
                    )}
                  </div>
                  {patient.emergencyContactName && (
                    <div>
                      <EditableField
                        label="Emergency Contact"
                        value={patient.emergencyContactName}
                        onSave={(val) => handleFieldUpdate('emergencyContactName', val)}
                        type="text"
                      />
                      {patient.emergencyContactPhone && (
                        <EditableField
                          label="Emergency Contact Phone"
                          value={patient.emergencyContactPhone}
                          onSave={(val) => handleFieldUpdate('emergencyContactPhone', val)}
                          type="tel"
                          className="mt-2"
                        />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Medical Records Tab - Only visible to doctors and admins */}
        {canViewMedicalRecords && (
          <TabsContent value="medical" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Medical Records</CardTitle>
                <CardDescription>Patient&apos;s medical history and records</CardDescription>
              </CardHeader>
              <CardContent>
                {medicalRecords.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No medical records found.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Doctor</TableHead>
                        <TableHead>Diagnosis</TableHead>
                        <TableHead>Prescription</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="w-[50px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {medicalRecords.map((record) => {
                        const recordDate = record.date || record.createdAt
                        const dateValue =
                          typeof recordDate === 'string' || recordDate instanceof Date
                            ? new Date(recordDate)
                            : new Date()

                        const doctor = record.doctor as { user?: { name?: string } } | undefined
                        const diagnosis =
                          typeof record.diagnosis === 'string' ? record.diagnosis : undefined
                        const prescription =
                          typeof record.prescription === 'string' ? record.prescription : undefined
                        const notes = typeof record.notes === 'string' ? record.notes : undefined

                        return (
                          <TableRow key={record.id}>
                            <TableCell>{dateValue.toLocaleDateString()}</TableCell>
                            <TableCell>{doctor?.user?.name || 'Unknown'}</TableCell>
                            <TableCell>{diagnosis || '-'}</TableCell>
                            <TableCell>{prescription || '-'}</TableCell>
                            <TableCell className="max-w-xs truncate">{notes || '-'}</TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleViewMedicalRecord(record)}>
                                    <Eye className="mr-2 h-4 w-4" />
                                    View Record
                                  </DropdownMenuItem>
                                  {canEdit && (
                                    <>
                                      <DropdownMenuItem
                                        onClick={() => handleEditMedicalRecord(record)}
                                      >
                                        <Pencil className="mr-2 h-4 w-4" />
                                        Edit Record
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setSelectedMedicalRecord(record)
                                          setShowDeleteMedicalRecord(true)
                                        }}
                                        className="text-destructive"
                                      >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Payment Records Tab */}
        <TabsContent value="payments" className="space-y-6">
          {/* Payment Plan Section - Available for All Patients */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Payment Plan</CardTitle>
                  <CardDescription>
                    {paymentPlan
                      ? 'Payment plan details for treatment'
                      : 'No payment plan assigned yet'}
                  </CardDescription>
                </div>
                <PaymentPlanDialog
                  patientId={patient.id}
                  existingPlan={paymentPlan}
                  onSuccess={handlePaymentPlanSuccess}
                  isAdmin={isAdmin}
                />
              </div>
            </CardHeader>
            <CardContent>
              {paymentPlan ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Total Amount</p>
                      <p className="text-lg font-semibold">
                        {formatCurrency(paymentPlan.totalAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Amount per Installment
                      </p>
                      <p className="text-lg font-semibold">
                        {paymentPlan.amountPerInstallment
                          ? formatCurrency(paymentPlan.amountPerInstallment)
                          : 'Flexible'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Payment Frequency</p>
                      <p className="capitalize">{paymentPlan.paymentFrequency || 'Flexible'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Start Date</p>
                      <p>{new Date(paymentPlan.startDate).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Status</p>
                      <Badge
                        variant={
                          paymentPlan.status === 'activated'
                            ? 'default'
                            : paymentPlan.status === 'completed'
                              ? 'secondary'
                              : paymentPlan.status === 'overdue'
                                ? 'destructive'
                                : paymentPlan.status === 'paused'
                                  ? 'destructive'
                                  : 'outline'
                        }
                      >
                        {paymentPlan.status}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Plan Type</p>
                      <Badge variant="outline" className="capitalize">
                        {paymentPlan.type || 'fixed'}
                      </Badge>
                    </div>
                  </div>
                  {paymentPlan.notes && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Notes</p>
                      <p className="text-sm">{paymentPlan.notes}</p>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    {paymentPlan.status === 'paused' ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={async () => {
                          const result = await unpausePaymentPlan(paymentPlan.id)
                          if (result.success) {
                            toast.success('Payment plan activated')
                            handlePaymentPlanSuccess()
                          } else {
                            toast.error(result.error || 'Failed to activate payment plan')
                          }
                        }}
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Paused
                      </Button>
                    ) : paymentPlan.status === 'activated' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const result = await pausePaymentPlan(paymentPlan.id)
                          if (result.success) {
                            toast.success('Payment plan paused')
                            handlePaymentPlanSuccess()
                          } else {
                            toast.error(result.error || 'Failed to pause payment plan')
                          }
                        }}
                      >
                        <Pause className="mr-2 h-4 w-4" />
                        Pause
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No payment plan has been created for this patient yet.</p>
                  <p className="text-sm mt-2">
                    Click &quot;Select Payment Plan&quot; above to get started.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment Records</CardTitle>
              <CardDescription>Patient&apos;s payment history</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="one-time" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="one-time">One-Time Payments</TabsTrigger>
                  <TabsTrigger value="plan">Payment Plan</TabsTrigger>
                </TabsList>

                <TabsContent value="one-time" className="mt-4">
                  {oneTimePayments.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No one-time payments found.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-[50px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {oneTimePayments.map((payment) => {
                          const createdAt = payment.createdAt
                          const paymentDate =
                            typeof createdAt === 'string' || createdAt instanceof Date
                              ? new Date(createdAt)
                              : new Date()

                          const method =
                            typeof payment.method === 'string' ? payment.method : 'unknown'
                          const status =
                            typeof payment.status === 'string' ? payment.status : 'unknown'
                          const description =
                            typeof payment.description === 'string' ? payment.description : null

                          return (
                            <TableRow key={payment.id}>
                              <TableCell>{paymentDate.toLocaleDateString()}</TableCell>
                              <TableCell className="font-medium">
                                {formatCurrency(payment.amount)}
                              </TableCell>
                              <TableCell className="capitalize">
                                {method.replace('_', ' ')}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    status === 'completed'
                                      ? 'default'
                                      : status === 'pending'
                                        ? 'secondary'
                                        : status === 'failed'
                                          ? 'destructive'
                                          : 'outline'
                                  }
                                >
                                  {status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {(() => {
                                  if (!description) return '-'
                                  const parts = description.split(' - ')
                                  return parts[0] || '-'
                                })()}
                              </TableCell>
                              <TableCell>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                      <span className="sr-only">Open menu</span>
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleViewReceipt(payment as PaymentForReceipt)
                                      }
                                    >
                                      <Eye className="mr-2 h-4 w-4" />
                                      View Receipt
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handlePrintReceipt(payment as PaymentForReceipt)
                                      }
                                    >
                                      <Printer className="mr-2 h-4 w-4" />
                                      Print Receipt
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>

                <TabsContent value="plan" className="mt-4 space-y-6">
                  {/* Outstanding Balance Summary - Only for Ortho Patients with Payment Plan */}
                  {patient.isOrtho && paymentPlan && (
                    <div className="p-4 rounded-lg border bg-muted/50">
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Total Amount</p>
                          <p className="text-lg font-semibold">
                            {formatCurrency(paymentPlan.totalAmount)}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Total Paid</p>
                          <p className="text-lg font-semibold text-green-600">
                            {formatCurrency(
                              planPayments
                                .filter((p) => p.status === 'completed')
                                .reduce((sum, p) => sum + p.amount, 0)
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">
                            Outstanding Balance
                          </p>
                          <p className="text-lg font-semibold text-destructive">
                            {formatCurrency(
                              paymentPlan.totalAmount -
                                planPayments
                                  .filter((p) => p.status === 'completed')
                                  .reduce((sum, p) => sum + p.amount, 0)
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {planPayments.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No plan installments found.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-[50px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {planPayments.map((payment) => {
                          const createdAt = payment.createdAt
                          const paymentDate =
                            typeof createdAt === 'string' || createdAt instanceof Date
                              ? new Date(createdAt)
                              : new Date()

                          const method =
                            typeof payment.method === 'string' ? payment.method : 'unknown'
                          const status =
                            typeof payment.status === 'string' ? payment.status : 'unknown'
                          const description =
                            typeof payment.description === 'string' ? payment.description : null

                          return (
                            <TableRow key={payment.id}>
                              <TableCell>{paymentDate.toLocaleDateString()}</TableCell>
                              <TableCell className="font-medium">
                                {formatCurrency(payment.amount)}
                              </TableCell>
                              <TableCell className="capitalize">
                                {method.replace('_', ' ')}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    status === 'completed'
                                      ? 'default'
                                      : status === 'pending'
                                        ? 'secondary'
                                        : status === 'failed'
                                          ? 'destructive'
                                          : 'outline'
                                  }
                                >
                                  {status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {(() => {
                                  if (!description) return '-'
                                  const parts = description.split(' - ')
                                  return parts[0] || '-'
                                })()}
                              </TableCell>
                              <TableCell>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                      <span className="sr-only">Open menu</span>
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleViewReceipt(payment as PaymentForReceipt)
                                      }
                                    >
                                      <Eye className="mr-2 h-4 w-4" />
                                      View Receipt
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handlePrintReceipt(payment as PaymentForReceipt)
                                      }
                                    >
                                      <Printer className="mr-2 h-4 w-4" />
                                      Print Receipt
                                    </DropdownMenuItem>
                                    {isAdmin && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() =>
                                            handleEditPayment({
                                              id: payment.id,
                                              amount: payment.amount,
                                            })
                                          }
                                        >
                                          <Pencil className="mr-2 h-4 w-4" />
                                          Edit Amount
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Medical Record Dialogs */}
      {selectedMedicalRecord && (
        <>
          <ViewMedicalRecordDialog
            open={showViewMedicalRecord}
            onOpenChange={setShowViewMedicalRecord}
            record={selectedMedicalRecord}
          />
          <EditMedicalRecordDialog
            open={showEditMedicalRecord}
            onOpenChange={setShowEditMedicalRecord}
            record={selectedMedicalRecord}
          />
          <DeleteConfirmationDialog
            open={showDeleteMedicalRecord}
            onOpenChange={setShowDeleteMedicalRecord}
            onConfirm={handleDeleteMedicalRecord}
            title="Delete Medical Record"
            description="Are you sure you want to delete this medical record? This action cannot be undone."
            itemName={`Medical record from ${(() => {
              const date = selectedMedicalRecord.date
              if (!date) return 'unknown date'
              const dateValue =
                typeof date === 'string' || date instanceof Date ? new Date(date) : null
              return dateValue ? format(dateValue, 'MMMM d, yyyy') : 'unknown date'
            })()}`}
            isLoading={isDeletingMedicalRecord}
          />
        </>
      )}

      {/* Receipt Dialog */}
      {receiptData && (
        <ReceiptViewDialog
          open={showReceiptDialog}
          onOpenChange={setShowReceiptDialog}
          receiptData={receiptData}
        />
      )}

      {/* Edit Payment Dialog */}
      <Dialog open={!!editingPayment} onOpenChange={(open) => !open && setEditingPayment(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Payment Amount</DialogTitle>
            <DialogDescription>
              Update the amount for this payment installment. This action is restricted to
              administrators.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdatePayment}>
            <div className="grid gap-4 py-4">
              <div className="grid w-full max-w-sm items-center gap-1.5">
                <Label htmlFor="amount">Amount (GHS)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingPayment(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updatingPayment}>
                {updatingPayment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update Amount
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <EditPatientDialog patient={patient} open={showEditDialog} onOpenChange={setShowEditDialog} />
    </div>
  )
}
