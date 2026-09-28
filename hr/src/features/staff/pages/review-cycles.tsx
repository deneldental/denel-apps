import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
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
import { format, parseISO } from 'date-fns'
import { ClipboardCheck, Loader2, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  createReviewCycle,
  getReviewCycles,
  type ReviewCycle,
  setReviewCycleStatus,
} from '@/lib/actions/hr-phase2-4'
import { getStaff } from '@/lib/actions/staff'
import { StatusBadge } from '@/shared/components/status-badge'

type StaffOption = { id: string; fullName: string }

const CYCLE_TYPES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannual', label: 'Semi-annual' },
  { value: 'annual', label: 'Annual' },
]

function formatDate(input: string | null | undefined): string {
  if (!input) return '—'
  try {
    return format(parseISO(input), 'MMM d, yyyy')
  } catch {
    return input ?? '—'
  }
}

export default function ReviewCyclesPage() {
  const [cycles, setCycles] = useState<ReviewCycle[]>([])
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusBusy, setStatusBusy] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    cycleType: 'quarterly',
    startDate: '',
    endDate: '',
    participantIds: new Set<string>(),
  })

  const load = useCallback(async () => {
    setLoading(true)
    const [cyclesRes, staffRes] = await Promise.all([getReviewCycles(), getStaff()])
    setLoading(false)
    if (cyclesRes.success && Array.isArray(cyclesRes.data)) setCycles(cyclesRes.data)
    if (staffRes.success && Array.isArray(staffRes.data)) {
      setStaffOptions(
        (staffRes.data as Array<{ id: string; fullName: string }>).map((s) => ({
          id: s.id,
          fullName: s.fullName,
        }))
      )
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function toggleParticipant(id: string) {
    setForm((s) => {
      const next = new Set(s.participantIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...s, participantIds: next }
    })
  }

  async function handleCreate() {
    if (!form.name || !form.startDate || !form.endDate) {
      toast.error('Name, start, and end dates are required.')
      return
    }
    setSaving(true)
    const res = await createReviewCycle({
      name: form.name,
      cycleType: form.cycleType,
      startDate: form.startDate,
      endDate: form.endDate,
      participantStaffIds: Array.from(form.participantIds),
    })
    setSaving(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to create cycle')
      return
    }
    toast.success(`Cycle "${form.name}" created.`)
    setDialogOpen(false)
    setForm({
      name: '',
      cycleType: 'quarterly',
      startDate: '',
      endDate: '',
      participantIds: new Set(),
    })
    await load()
  }

  async function handleStatusChange(cycle: ReviewCycle, status: ReviewCycle['status']) {
    setStatusBusy(cycle.id)
    setCycles((prev) => prev.map((c) => (c.id === cycle.id ? { ...c, status } : c)))
    const res = await setReviewCycleStatus(cycle.id, status)
    setStatusBusy(null)
    if (!res.success) {
      toast.error(res.error || 'Failed to update status')
      await load()
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Review cycles</h1>
          <p className="mt-1 text-muted-foreground">
            Run quarterly / annual performance reviews against a defined participant list.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New cycle
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4" />
            All cycles
          </CardTitle>
          <CardDescription>
            Move a draft to active to open self-assessments. Close it when all reviews are
            finalised.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : cycles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No cycles yet. Create one to kick off a review round.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {cycles.map((cycle) => (
                <li
                  key={cycle.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{cycle.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {cycle.cycleType} · {formatDate(cycle.startDate)} –{' '}
                      {formatDate(cycle.endDate)}
                    </p>
                  </div>
                  <StatusBadge status={cycle.status} />
                  <Select
                    value={cycle.status}
                    onValueChange={(v) => handleStatusChange(cycle, v as ReviewCycle['status'])}
                    disabled={statusBusy === cycle.id}
                  >
                    <SelectTrigger className="h-7 w-[110px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* New cycle dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New review cycle</DialogTitle>
            <DialogDescription>
              Participants are added to the cycle on create. You can add more later from each staff
              profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cycle-name">Name</Label>
              <Input
                id="cycle-name"
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                placeholder="e.g. Q2 2026 Performance Review"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cycle-type">Type</Label>
                <Select
                  value={form.cycleType}
                  onValueChange={(v) => setForm((s) => ({ ...s, cycleType: v }))}
                >
                  <SelectTrigger id="cycle-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CYCLE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cycle-start">Start</Label>
                <Input
                  id="cycle-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((s) => ({ ...s, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cycle-end">End</Label>
                <Input
                  id="cycle-end"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((s) => ({ ...s, endDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Participants ({form.participantIds.size})</Label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-2">
                {staffOptions.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-background"
                  >
                    <Checkbox
                      checked={form.participantIds.has(s.id)}
                      onCheckedChange={() => toggleParticipant(s.id)}
                    />
                    {s.fullName}
                  </label>
                ))}
                {staffOptions.length === 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">No active staff.</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                'Create cycle'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
