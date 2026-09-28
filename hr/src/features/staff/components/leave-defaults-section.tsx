// Leave allocation — clinic-wide Total Leave (days/year) and how it splits into
// Annual Leave (the single bulk block) + Casual Leave (taken in bits). Per-staff
// total overrides live on the Employment editor. Consumed by the leave request
// flow + balance engine. Lives on the Requests page (Leave settings tab).

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@denel/ui'
import { CalendarOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'

const TOTAL_KEY = 'hr:annual_leave_default_days'
const ANNUAL_BLOCK_KEY = 'hr:annual_leave_block_days'

export function LeaveDefaultsSection() {
  // Total Leave (days/year) and the Annual-block size ('' = auto 50/50 split).
  const [total, setTotal] = useState('')
  const [annualBlock, setAnnualBlock] = useState('')
  const [initial, setInitial] = useState({ total: '', annualBlock: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const [totalRes, blockRes] = await Promise.all([
        api.get<number | null>(`/api/settings/kv/${encodeURIComponent(TOTAL_KEY)}`),
        api.get<number | null>(`/api/settings/kv/${encodeURIComponent(ANNUAL_BLOCK_KEY)}`),
      ])
      const t = totalRes.success && typeof totalRes.data === 'number' ? String(totalRes.data) : '20'
      const b = blockRes.success && typeof blockRes.data === 'number' ? String(blockRes.data) : ''
      setTotal(t)
      setAnnualBlock(b)
      setInitial({ total: t, annualBlock: b })
      setLoading(false)
    })()
  }, [])

  // Derived split preview. Blank block → half the total (rounded up to Annual).
  const totalNum = Number(total) || 0
  const annualQuota =
    annualBlock.trim() === ''
      ? Math.ceil(totalNum / 2)
      : Math.min(Math.max(0, Math.round(Number(annualBlock) || 0)), totalNum)
  const casualQuota = Math.max(0, totalNum - annualQuota)

  async function handleSave() {
    const t = Number(total)
    if (!Number.isInteger(t) || t < 0) {
      toast.error('Total leave must be a whole number of days (0 or more).')
      return
    }
    let blockValue: number | null = null
    if (annualBlock.trim() !== '') {
      const b = Number(annualBlock)
      if (!Number.isInteger(b) || b < 0) {
        toast.error('Annual leave block must be a whole number of days (0 or more).')
        return
      }
      if (b > t) {
        toast.error('Annual leave block cannot exceed the total leave.')
        return
      }
      blockValue = b
    }
    setSaving(true)
    const [r1, r2] = await Promise.all([
      api.put<{ success: true }>(`/api/settings/kv/${encodeURIComponent(TOTAL_KEY)}`, { value: t }),
      api.put<{ success: true }>(`/api/settings/kv/${encodeURIComponent(ANNUAL_BLOCK_KEY)}`, {
        value: blockValue,
      }),
    ])
    setSaving(false)
    if (r1.success && r2.success) {
      toast.success('Leave allocation saved.')
      setInitial({ total, annualBlock })
    } else {
      toast.error(r1.error || r2.error || 'Failed to save leave allocation')
    }
  }

  const isDirty = total !== initial.total || annualBlock !== initial.annualBlock

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarOff className="h-4 w-4" />
          Leave allocation
        </CardTitle>
        <CardDescription>
          The clinic-wide Total Leave each staff gets per year, and how it splits into Annual Leave
          (a single bulk block) and Casual Leave (taken in bits). Per-staff total overrides live on
          the Employment editor. Resets each calendar year — no carry-over.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground py-2">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leave-total" className="text-xs">
                  Total Leave (days/year)
                </Label>
                <Input
                  id="leave-total"
                  type="number"
                  min={0}
                  step={1}
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  className="w-[150px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leave-annual-block" className="text-xs">
                  Annual Leave block (days)
                </Label>
                <Input
                  id="leave-annual-block"
                  type="number"
                  min={0}
                  step={1}
                  placeholder={`Auto (${Math.ceil(totalNum / 2)})`}
                  value={annualBlock}
                  onChange={(e) => setAnnualBlock(e.target.value)}
                  className="w-[150px]"
                />
              </div>
              <Button onClick={handleSave} disabled={!isDirty || saving}>
                Save
              </Button>
            </div>

            {/* Live split preview */}
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1">
                <span className="font-medium">Annual Leave</span>
                <span className="text-muted-foreground">single block</span>
                <span className="tabular-nums">{annualQuota} days</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1">
                <span className="font-medium">Casual Leave</span>
                <span className="text-muted-foreground">in bits</span>
                <span className="tabular-nums">{casualQuota} days</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-muted-foreground">
                = {totalNum} total
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Leave the Annual block blank to split the total in half. Annual leave taken beyond its
              block draws from the Casual allowance.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
