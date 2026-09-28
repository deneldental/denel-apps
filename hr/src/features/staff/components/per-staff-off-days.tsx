// PR-19 — compact per-staff off-day toggles for the Employment form.
//
// The Attendance page's bulk editor (attendance-config-sections.tsx) still
// exists for HR-wide management. This one drops a small toggle row into the
// Employment editor so HR doesn't have to leave the staff form to set a new
// hire's recurring off-days. Both surfaces write to the same /api/staff/off-days
// endpoints, so updates from either place stay consistent.

import { Button } from '@denel/ui'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  deleteStaffOffDay,
  getStaffOffDays,
  type OffDayRow,
  setStaffOffDay,
} from '@/lib/actions/staff'

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
] as const

export function PerStaffOffDays({ staffId }: { staffId: string }) {
  const [rows, setRows] = useState<OffDayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingDow, setSavingDow] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await getStaffOffDays(staffId)
      if (!cancelled) {
        if (res.success) setRows(res.data)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [staffId])

  // PR-26 — defensive filter so a malformed row from the API (missing
  // dayOfWeek) doesn't add `undefined` to the set and break the toggle
  // logic for legitimate days.
  const offSet = new Set(
    rows.filter((r) => typeof r.dayOfWeek === 'number').map((r) => r.dayOfWeek)
  )

  async function toggle(dow: number) {
    setSavingDow(dow)
    const isOff = offSet.has(dow)
    const res = isOff ? await deleteStaffOffDay(staffId, dow) : await setStaffOffDay(staffId, dow)
    setSavingDow(null)
    if (!res.success) {
      toast.error(res.error || 'Failed to update off-days')
      return
    }
    // Re-fetch instead of optimistic merge — the row shape from POST is
    // narrower than the GET overview, and re-fetching gives a single source
    // of truth at the cost of one tiny request.
    const fresh = await getStaffOffDays(staffId)
    if (fresh.success) setRows(fresh.data)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {DAYS_OF_WEEK.map((d) => {
          const isOff = offSet.has(d.value)
          return (
            <Button
              key={d.value}
              type="button"
              variant={isOff ? 'default' : 'outline'}
              size="sm"
              disabled={loading || savingDow === d.value}
              onClick={() => toggle(d.value)}
              className="min-w-[56px]"
            >
              {d.label}
            </Button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Recurring weekly off-days. Toggle a day to add/remove it. Off-days don&apos;t count as
        absences in attendance summaries.
      </p>
    </div>
  )
}
