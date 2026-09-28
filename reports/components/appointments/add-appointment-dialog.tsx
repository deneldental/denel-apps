import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
// import { useToast } from "@/hooks/use-toast"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getAppointmentTypes } from '@/lib/actions/appointment-types'
import { createAppointment } from '@/lib/actions/appointments'
import { getDoctors } from '@/lib/actions/doctors'
import { getPatients } from '@/lib/actions/patients'
import type { appointments, appointmentTypes, doctors, patients } from '@/lib/db/schema'
import { cn } from '@/lib/utils'

type Patient = typeof patients.$inferSelect
type Doctor = typeof doctors.$inferSelect & {
  user: {
    id: string
    name: string
    email: string
    phone: string | null
    image: string | null
  } | null
}
type AppointmentType = typeof appointmentTypes.$inferSelect

interface AddAppointmentDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultDate?: Date
  trigger?: React.ReactNode
}

export function AddAppointmentDialog({
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  defaultDate,
  trigger,
}: AddAppointmentDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  // const { toast } = useToast()

  // Derived state to handle both controlled and uncontrolled modes
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (val: boolean) => {
    if (!val) {
      // Reset state when dialog closes
      setSendSMS(false)
      setSelectedPatientId('')
    }
    if (isControlled) {
      setControlledOpen?.(val)
    } else {
      setInternalOpen(val)
    }
  }

  // State for selections
  const [patientsList, setPatientsList] = useState<Patient[]>([])
  const [doctorsList, setDoctorsList] = useState<Doctor[]>([])
  const [appointmentTypesList, setAppointmentTypesList] = useState<AppointmentType[]>([])
  const [sendSMS, setSendSMS] = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState<string>('')
  const [patientSearchOpen, setPatientSearchOpen] = useState(false)

  useEffect(() => {
    if (open) {
      getPatients().then((res) => {
        if (res.success) setPatientsList(res.data || [])
      })
      getDoctors().then((res) => {
        if (res.success) setDoctorsList(res.data || [])
      })
      getAppointmentTypes().then((res) => {
        if (res.success) setAppointmentTypesList(res.data || [])
      })
    }
  }, [open])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    const formData = new FormData(event.currentTarget)
    const dateStr = formData.get('date') as string
    const timeStr = formData.get('time') as string

    // Combine date and time into a single Date object
    const dateTime = new Date(`${dateStr}T${timeStr}`)

    const data = {
      patientId: formData.get('patientId') as string,
      doctorId: formData.get('doctorId') as string,
      date: dateTime,
      type: formData.get('type') as string,
      status: 'scheduled',
      notes: formData.get('notes') as string,
    }

    const result = await createAppointment(
      data as typeof appointments.$inferInsert,
      sendSMS,
      dateStr,
      timeStr
    )

    setIsLoading(false)

    if (result.success) {
      setOpen(false)

      if (result.smsError) {
        toast.warning(`Appointment scheduled, but SMS failed: ${result.smsError}`)
      } else {
        const message = result.smsSent
          ? 'Appointment scheduled and SMS notification sent to patient.'
          : 'Appointment scheduled.'
        toast.success(message)
      }
    } else {
      toast.error(result.error || 'Something went wrong.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Appointment
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New Appointment</DialogTitle>
            <DialogDescription>Schedule a new appointment.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="patientId">Patient</Label>
              <Popover open={patientSearchOpen} onOpenChange={setPatientSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={patientSearchOpen}
                    className="w-full justify-between"
                  >
                    {selectedPatientId
                      ? patientsList.find((p) => p.id === selectedPatientId)?.name
                      : 'Select patient'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput placeholder="Search patients..." />
                    <CommandList>
                      <CommandEmpty>No patient found.</CommandEmpty>
                      <CommandGroup>
                        {patientsList.map((patient) => (
                          <CommandItem
                            key={patient.id}
                            value={patient.name}
                            onSelect={() => {
                              setSelectedPatientId(patient.id)
                              setPatientSearchOpen(false)
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                selectedPatientId === patient.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            {patient.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <input type="hidden" name="patientId" value={selectedPatientId} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="doctorId">Doctor</Label>
              <Select name="doctorId" required>
                <SelectTrigger>
                  <SelectValue placeholder="Select doctor" />
                </SelectTrigger>
                <SelectContent>
                  {doctorsList.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.user?.name || 'Unknown Doctor'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                name="date"
                type="date"
                required
                defaultValue={
                  defaultDate
                    ? new Date(defaultDate.getTime() - defaultDate.getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(0, 10)
                    : undefined
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="time">Time</Label>
              <Input
                id="time"
                name="time"
                type="time"
                required
                defaultValue={
                  defaultDate
                    ? new Date(defaultDate.getTime() - defaultDate.getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(11, 16)
                    : undefined
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="type">Type</Label>
              <Select name="type" defaultValue="consultation">
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {appointmentTypesList.map((type) => (
                    <SelectItem key={type.id} value={type.name}>
                      {type.displayName || type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" name="notes" />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="send-sms"
                checked={sendSMS}
                onCheckedChange={(checked) => setSendSMS(checked === true)}
              />
              <Label htmlFor="send-sms" className="cursor-pointer text-sm">
                Send SMS notification to patient
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
