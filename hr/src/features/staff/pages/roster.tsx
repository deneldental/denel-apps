import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@denel/ui'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  assignRoster,
  createShift,
  getRoster,
  getShifts,
  type Shift,
  type ShiftAssignment,
} from '@/lib/actions/hr-phase2-4'
import { getStaff } from '@/lib/actions/staff'
import { TagBadge } from '@/shared/components/tag-badge'

type StaffOption = { id: string; fullName: string }

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default function RosterPage() {
  // Week anchor — always a Monday in clinic-local time.
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [shifts, setShifts] = useState<Shift[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [loading, setLoading] = useState(true)

  // Assignment dialog
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignSubmitting, setAssignSubmitting] = useState(false)
  const [assignSeed, setAssignSeed] = useState<{ shiftId: string; date: string } | null>(null)
  const [assignStaffId, setAssignStaffId] = useState<string>('')

  // Shift create dialog
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false)
  const [shiftSaving, setShiftSaving] = useState(false)
  const [shiftForm, setShiftForm] = useState({
    name: '',
    startTime: '08:00',
    endTime: '17:00',
  })

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  const load = useCallback(async () => {
    setLoading(true)
    const from = toIsoDate(weekStart)
    const to = toIsoDate(addDays(weekStart, 6))
    const [shiftRes, rosterRes, staffRes] = await Promise.all([
      getShifts(),
      getRoster(from, to),
      getStaff(),
    ])
    setLoading(false)
    if (shiftRes.success && Array.isArray(shiftRes.data)) setShifts(shiftRes.data)
    if (rosterRes.success && Array.isArray(rosterRes.data)) setAssignments(rosterRes.data)
    if (staffRes.success && Array.isArray(staffRes.data)) {
      setStaffOptions(
        (staffRes.data as Array<{ id: string; fullName: string }>).map((s) => ({
          id: s.id,
          fullName: s.fullName,
        }))
      )
    }
  }, [weekStart])

  useEffect(() => {
    void load()
  }, [load])

  function openAssignFor(shiftId: string, date: string) {
    setAssignSeed({ shiftId, date })
    setAssignStaffId('')
    setAssignOpen(true)
  }

  async function handleAssign() {
    if (!assignSeed || !assignStaffId) {
      toast.error('Pick a staff member.')
      return
    }
    setAssignSubmitting(true)
    const res = await assignRoster([
      {
        shiftId: assignSeed.shiftId,
        staffId: assignStaffId,
        date: assignSeed.date,
      },
    ])
    setAssignSubmitting(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to assign shift')
      return
    }
    toast.success('Shift assigned.')
    setAssignOpen(false)
    setAssignSeed(null)
    setAssignStaffId('')
    await load()
  }

  async function handleCreateShift() {
    if (!shiftForm.name || !shiftForm.startTime || !shiftForm.endTime) {
      toast.error('Name, start, and end are required.')
      return
    }
    setShiftSaving(true)
    const res = await createShift({
      name: shiftForm.name,
      startTime: shiftForm.startTime,
      endTime: shiftForm.endTime,
    })
    setShiftSaving(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to create shift')
      return
    }
    toast.success(`Shift "${shiftForm.name}" created.`)
    setShiftDialogOpen(false)
    setShiftForm({ name: '', startTime: '08:00', endTime: '17:00' })
    await load()
  }

  function assignmentsFor(shiftId: string, date: string): ShiftAssignment[] {
    return assignments.filter((a) => a.shiftId === shiftId && a.date === date)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Roster</h1>
          <p className="mt-1 text-muted-foreground">
            Assign staff to shifts for the week. Bulk-assign up to 500 entries at once.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShiftDialogOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New shift
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" />
              Week of {format(weekStart, 'MMM d, yyyy')}
            </CardTitle>
            <CardDescription>
              Click an empty cell to assign a staff member. Capped at 500 assignments per save.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setWeekStart((d) => addDays(d, -7))}
              aria-label="Previous week"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            >
              This week
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setWeekStart((d) => addDays(d, 7))}
              aria-label="Next week"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : shifts.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No shifts defined yet. Click "New shift" to create your first.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="w-[140px] border-b border-border bg-muted/30 px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                      Shift
                    </th>
                    {days.map((d, i) => (
                      <th
                        key={d.toISOString()}
                        className="border-b border-border bg-muted/30 px-2 py-2 text-left text-xs font-medium text-muted-foreground"
                      >
                        {WEEKDAY_LABELS[i]} {format(d, 'd')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((shift) => (
                    <tr key={shift.id}>
                      <td className="border-b border-border bg-card px-2 py-2 align-top">
                        <p className="text-sm font-medium">{shift.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {shift.startTime}–{shift.endTime}
                        </p>
                      </td>
                      {days.map((d) => {
                        const dateIso = toIsoDate(d)
                        const cellAssignments = assignmentsFor(shift.id, dateIso)
                        return (
                          <td
                            key={dateIso}
                            className="cursor-pointer border-b border-border align-top hover:bg-muted/30"
                            onClick={() => openAssignFor(shift.id, dateIso)}
                          >
                            <div className="space-y-1 px-2 py-2">
                              {cellAssignments.length === 0 ? (
                                <span className="text-[10px] text-muted-foreground/60">
                                  + Assign
                                </span>
                              ) : (
                                cellAssignments.map((a) => (
                                  <TagBadge
                                    key={a.id}
                                    label={a.staffName}
                                    className="block max-w-full truncate text-[10px]"
                                  >
                                    {a.staffName}
                                  </TagBadge>
                                ))
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assign dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign shift</DialogTitle>
            <DialogDescription>
              {assignSeed
                ? `${shifts.find((s) => s.id === assignSeed.shiftId)?.name ?? 'Shift'} on ${format(parseISO(assignSeed.date), 'EEE, MMM d')}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="assign-staff">Staff</Label>
            <Select value={assignStaffId} onValueChange={setAssignStaffId}>
              <SelectTrigger id="assign-staff">
                <SelectValue placeholder="Select a staff member" />
              </SelectTrigger>
              <SelectContent>
                {staffOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssignOpen(false)}
              disabled={assignSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleAssign} disabled={assignSubmitting}>
              {assignSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Assigning…
                </>
              ) : (
                'Assign'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New shift dialog */}
      <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New shift</DialogTitle>
            <DialogDescription>
              Shifts are reusable templates. Times are clinic-local.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="shift-name">Name</Label>
              <Input
                id="shift-name"
                placeholder="e.g. Morning"
                value={shiftForm.name}
                onChange={(e) => setShiftForm((s) => ({ ...s, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="shift-start">Start</Label>
                <Input
                  id="shift-start"
                  type="time"
                  value={shiftForm.startTime}
                  onChange={(e) => setShiftForm((s) => ({ ...s, startTime: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shift-end">End</Label>
                <Input
                  id="shift-end"
                  type="time"
                  value={shiftForm.endTime}
                  onChange={(e) => setShiftForm((s) => ({ ...s, endTime: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShiftDialogOpen(false)}
              disabled={shiftSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateShift} disabled={shiftSaving}>
              {shiftSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                'Create shift'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
