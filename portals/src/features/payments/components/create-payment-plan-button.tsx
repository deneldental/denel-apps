import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PatientPicker } from '@/shared/components/patient-picker'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'

// Tiny entry-point button: opens a dialog, lets the user pick a patient via
// the shared PatientPicker, then deep-links to that patient's payment-records
// tab where the actual plan creation happens.
export function CreatePaymentPlanButton() {
  const [open, setOpen] = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const navigate = useNavigate()

  function handleConfirm(id: string) {
    setSelectedPatientId(id)
    setOpen(false)
    navigate(`/patients/${id}?tab=payment-records`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setSelectedPatientId('')
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Create Payment Plan
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Payment Plan</DialogTitle>
          <DialogDescription>Select a patient to create a payment plan for.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="create-plan-patient">Patient</Label>
          <PatientPicker
            id="create-plan-patient"
            value={selectedPatientId}
            onChange={handleConfirm}
            placeholder="Search patient…"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
