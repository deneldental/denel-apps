import { Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { getPatients } from '@/lib/actions/patients'

interface Patient {
  id: string
  name: string
  patientId: string | null
}

export function CreatePaymentPlanButton() {
  const [open, setOpen] = useState(false)
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const fetchPatients = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getPatients()
      if (result.success && result.data) {
        setPatients(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch patients:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchPatients()
    }
  }, [open, fetchPatients])

  const handleSelectPatient = (patientId: string) => {
    setOpen(false)
    navigate(`/patient-records/${patientId}?tab=payment-records`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
        <Command className="rounded-lg border">
          <CommandInput placeholder="Search patients..." />
          <CommandList>
            <CommandEmpty>{loading ? 'Loading patients...' : 'No patients found.'}</CommandEmpty>
            <CommandGroup>
              {patients.map((patient) => (
                <CommandItem
                  key={patient.id}
                  value={patient.name}
                  onSelect={() => handleSelectPatient(patient.id)}
                  className="cursor-pointer"
                >
                  <Search className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="font-medium">{patient.name}</span>
                    {patient.patientId && (
                      <span className="text-xs text-muted-foreground">ID: {patient.patientId}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
