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
  Textarea,
} from '@denel/ui'
import { formatCurrency } from '@denel/utils'
import { format, parseISO } from 'date-fns'
import { Coins, Loader2, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type CompensationRow,
  getCompensation,
  recordCompensation,
} from '@/lib/actions/hr-phase2-4'
import { ACTIONS, MODULES } from '@/lib/modules'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'
import { usePermissions } from '@/shared/hooks/use-permissions'

const REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'hire', label: 'Hire' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'merit_increase', label: 'Merit increase' },
  { value: 'cola', label: 'Cost-of-living adjustment' },
  { value: 'demotion', label: 'Demotion' },
  { value: 'other', label: 'Other' },
]

function ghs(value: string | number | null | undefined, _currency = 'GHS'): string {
  if (value == null) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return String(value)
  return formatCurrency(n)
}

function formatDate(input: string | null | undefined): string {
  if (!input) return '—'
  try {
    return format(parseISO(input), 'MMM d, yyyy')
  } catch {
    return input
  }
}

export function CompensationTab({ staffId }: { staffId: string }) {
  // HR-M10/L9: recording compensation is payroll-grade — gate on payroll:update
  // to match the backend (which now enforces payroll:update for this action).
  const { hasPermission } = usePermissions()
  const canEditCompensation = hasPermission(MODULES.PAYROLL as string, ACTIONS.UPDATE as string)
  const [rows, setRows] = useState<CompensationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    baseAmount: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    currency: 'GHS',
    reason: 'merit_increase',
    notes: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getCompensation(staffId)
    setLoading(false)
    if (res.success && Array.isArray(res.data)) {
      setRows(res.data)
    } else {
      toast.error(res.error || 'Failed to load compensation history')
    }
  }, [staffId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSave() {
    const amount = Number(form.baseAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid base amount.')
      return
    }
    if (!form.effectiveFrom) {
      toast.error('Effective-from date is required.')
      return
    }
    setSaving(true)
    const res = await recordCompensation(staffId, {
      baseAmount: Math.round(amount * 100),
      effectiveFrom: form.effectiveFrom,
      currency: form.currency,
      reason: form.reason,
      notes: form.notes || undefined,
    })
    setSaving(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to record compensation change')
      return
    }
    toast.success('Compensation change recorded.')
    setDialogOpen(false)
    setForm({
      baseAmount: '',
      effectiveFrom: new Date().toISOString().slice(0, 10),
      currency: 'GHS',
      reason: 'merit_increase',
      notes: '',
    })
    await load()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4" />
            Compensation history
          </CardTitle>
          <CardDescription>
            Each change auto-closes the prior open-ended row so the timeline stays contiguous.
          </CardDescription>
        </div>
        {canEditCompensation && (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Record change
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No compensation history yet. Record the first entry to start the timeline.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold tabular-nums">
                      {ghs(row.baseAmount, row.currency)}
                    </p>
                    {row.reason && (
                      <TagBadge label={row.reason} className="text-[10px] capitalize">
                        {row.reason.replace(/_/g, ' ')}
                      </TagBadge>
                    )}
                    {!row.effectiveTo && (
                      <StatusBadge tone="success" className="text-[10px]">
                        Current
                      </StatusBadge>
                    )}
                  </div>
                  {row.notes && <p className="mt-0.5 text-xs text-muted-foreground">{row.notes}</p>}
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{formatDate(row.effectiveFrom)}</p>
                  {row.effectiveTo && <p>– {formatDate(row.effectiveTo)}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record compensation change</DialogTitle>
            <DialogDescription>
              The previous open-ended row is automatically closed to the day before this entry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="comp-amount">Base amount</Label>
                <Input
                  id="comp-amount"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 4500"
                  value={form.baseAmount}
                  onChange={(e) => setForm((s) => ({ ...s, baseAmount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="comp-currency">Currency</Label>
                <Input
                  id="comp-currency"
                  value={form.currency}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, currency: e.target.value.toUpperCase() }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="comp-effective">Effective from</Label>
                <Input
                  id="comp-effective"
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(e) => setForm((s) => ({ ...s, effectiveFrom: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="comp-reason">Reason</Label>
                <Select
                  value={form.reason}
                  onValueChange={(v) => setForm((s) => ({ ...s, reason: v }))}
                >
                  <SelectTrigger id="comp-reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REASON_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comp-notes">Notes</Label>
              <Textarea
                id="comp-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                placeholder="Optional context — link to performance review, board minute, etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Record'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
