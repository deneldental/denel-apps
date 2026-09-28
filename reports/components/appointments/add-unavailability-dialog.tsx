import { Ban, Loader2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useState } from 'react'
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
import { createUnavailability } from '@/lib/actions/doctor-availability'
import { getDoctors } from '@/lib/actions/doctors'

interface AddUnavailabilityDialogProps {
  currentDoctorId?: string
  currentDoctorName?: string
  isDoctor?: boolean
}

export function AddUnavailabilityDialog({
  currentDoctorId,
  currentDoctorName,
  isDoctor = false,
}: AddUnavailabilityDialogProps = {}) {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingDoctors, setIsLoadingDoctors] = useState(false)
  const [doctorsList, setDoctorsList] = useState<Array<{ id: string; user?: { name: string } }>>([])
  const [isAllDay, setIsAllDay] = useState(false)
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(
    isDoctor && currentDoctorId ? currentDoctorId : ''
  )

  // Sync selectedDoctorId when currentDoctorId changes
  useLayoutEffect(() => {
    if (isDoctor && currentDoctorId) {
      setSelectedDoctorId(currentDoctorId)
    }
  }, [isDoctor, currentDoctorId])

  useEffect(() => {
    if (!open) return

    let isMounted = true

    // Load doctors asynchronously - IIFE to avoid setState in effect body
    void (async () => {
      setIsLoadingDoctors(true)
      try {
        const res = await getDoctors()
        if (!isMounted) return
        if (res.success) {
          setDoctorsList(res.data || [])
        }
      } catch {
        // Error handled silently
      } finally {
        if (isMounted) {
          setIsLoadingDoctors(false)
        }
      }
    })()

    return () => {
      isMounted = false
    }
  }, [open])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    const formData = new FormData(event.currentTarget)
    const date = formData.get('date') as string

    let startDateTime: Date
    let endDateTime: Date

    if (isAllDay) {
      // Set to full clinic hours (8 AM to 8 PM)
      startDateTime = new Date(`${date}T08:00`)
      endDateTime = new Date(`${date}T20:00`)
    } else {
      const startTimeStr = formData.get('startTime') as string
      const endTimeStr = formData.get('endTime') as string

      // Combine date and time
      startDateTime = new Date(`${date}T${startTimeStr}`)
      endDateTime = new Date(`${date}T${endTimeStr}`)
    }

    const data: {
      doctorId: string
      startTime: Date
      endTime: Date
      reason: string
    } = {
      doctorId: selectedDoctorId,
      startTime: startDateTime,
      endTime: endDateTime,
      reason: formData.get('reason') as string,
    }

    const result = await createUnavailability(data)

    setIsLoading(false)

    if (result.success) {
      setOpen(false)
      setIsAllDay(false) // Reset for next use
      setSelectedDoctorId('') // Reset selected doctor
      toast.success('Unavailability blocked.')
    } else {
      toast.error(result.error || 'Failed to block time.')
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      // Reset state when closing
      setIsAllDay(false)
      setSelectedDoctorId('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Ban className="mr-2 h-4 w-4" />
          Block Time
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Block Doctor Availability</DialogTitle>
            <DialogDescription>Prevent appointments during specific times.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="doctorId" className="text-right">
                Doctor
                {isDoctor && (
                  <span className="block text-xs text-muted-foreground font-normal mt-1">
                    (Auto-assigned)
                  </span>
                )}
              </Label>
              <div className="col-span-3 space-y-1">
                {isLoadingDoctors ? (
                  <div className="col-span-3 h-10 flex items-center px-3 border rounded-md bg-muted">
                    <span className="text-sm text-muted-foreground">Loading doctors...</span>
                  </div>
                ) : isDoctor ? (
                  <>
                    <Input
                      type="text"
                      value={currentDoctorName || ''}
                      disabled
                      className="bg-muted cursor-not-allowed"
                    />
                    <input type="hidden" name="doctorId" value={selectedDoctorId || ''} />
                  </>
                ) : (
                  <Select
                    key={`doctor-select-${selectedDoctorId}`}
                    name="doctorId"
                    required
                    value={selectedDoctorId || undefined}
                    onValueChange={setSelectedDoctorId}
                  >
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
                )}
                {isDoctor && (
                  <p className="text-xs text-muted-foreground">Blocking time for your schedule</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="date" className="text-right">
                Date
              </Label>
              <Input id="date" name="date" type="date" className="col-span-3" required />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <div className="text-right" />
              <div className="col-span-3 flex items-center space-x-2">
                <Checkbox
                  id="allDay"
                  checked={isAllDay}
                  onCheckedChange={(checked) => setIsAllDay(checked as boolean)}
                />
                <Label htmlFor="allDay" className="text-sm font-normal cursor-pointer">
                  All day (8 AM - 8 PM)
                </Label>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="startTime" className="text-right">
                Start
              </Label>
              <Input
                id="startTime"
                name="startTime"
                type="time"
                className="col-span-3"
                required={!isAllDay}
                disabled={isAllDay}
                defaultValue="08:00"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="endTime" className="text-right">
                End
              </Label>
              <Input
                id="endTime"
                name="endTime"
                type="time"
                className="col-span-3"
                required={!isAllDay}
                disabled={isAllDay}
                defaultValue="20:00"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="reason" className="text-right">
                Reason
              </Label>
              <Input
                id="reason"
                name="reason"
                placeholder="e.g. Vacation, Surgery"
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Block Time
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
