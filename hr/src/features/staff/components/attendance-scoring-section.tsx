// Attendance scoring — clinic-wide thresholds + point weights used to score
// every staff member's attendance. Lives on the Attendance page (Scoring tab);
// moved out of HR Settings.

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
} from '@denel/ui'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type AttendanceScoringConfig,
  getAttendanceScoringConfig,
  saveAttendanceScoringConfig,
} from '@/lib/actions/staff'

const minToHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const hhmmToMin = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

export function AttendanceScoringSection() {
  const [cfg, setCfg] = useState<AttendanceScoringConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getAttendanceScoringConfig()
    if (res.success && res.data) setCfg(res.data)
    else toast.error(res.error || 'Failed to load attendance config')
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function set<K extends keyof AttendanceScoringConfig>(key: K, value: AttendanceScoringConfig[K]) {
    setCfg((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function handleSave() {
    if (!cfg) return
    setSaving(true)
    const res = await saveAttendanceScoringConfig(cfg)
    setSaving(false)
    if (res.success) toast.success('Attendance config saved')
    else toast.error(res.error || 'Failed to save')
  }

  if (loading || !cfg) {
    return (
      <Card>
        <CardContent className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const TIME_FIELDS: Array<{ key: keyof AttendanceScoringConfig; label: string; hint: string }> = [
    { key: 'onTimeBy', label: 'On time by', hint: 'Clock-in at/before this = on time' },
    { key: 'lateMildBy', label: 'Mild-late by', hint: 'After this = severely late' },
    { key: 'veryEarlyBy', label: 'Very-early leave by', hint: 'Clock-out at/before = very early' },
    { key: 'earlyBy', label: 'Early leave by', hint: 'At/before = early; after = on time' },
  ]
  const SCORE_FIELDS: Array<{ key: keyof AttendanceScoringConfig; label: string }> = [
    { key: 'baseDailyScore', label: 'Base daily points' },
    { key: 'lateMildScore', label: 'Mild-late penalty' },
    { key: 'lateSevereScore', label: 'Severe-late penalty' },
    { key: 'noShowScore', label: 'No-show penalty' },
    { key: 'veryEarlyScore', label: 'Very-early-leave penalty' },
    { key: 'earlyScore', label: 'Early-leave penalty' },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance scoring</CardTitle>
        <CardDescription>
          Clinic-wide thresholds + point weights used to score every staff member's attendance.
          Times are 24-hour; penalties are negative numbers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <div>
            <Label htmlFor="sat-excluded">Exclude Saturdays</Label>
            <p className="text-xs text-muted-foreground">Saturdays are not scoring days.</p>
          </div>
          <Switch
            id="sat-excluded"
            checked={cfg.saturdayExcluded}
            onCheckedChange={(v) => set('saturdayExcluded', v)}
          />
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Work-hour thresholds
          </h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {TIME_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  type="time"
                  value={minToHHMM(cfg[f.key] as number)}
                  onChange={(e) => set(f.key, hhmmToMin(e.target.value) as never)}
                />
                <p className="text-[11px] text-muted-foreground">{f.hint}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Point weights
          </h4>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {SCORE_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  type="number"
                  value={cfg[f.key] as number}
                  onChange={(e) => set(f.key, Number(e.target.value) as never)}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Lateness policy
          </h4>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="lateness-enabled">Enable weekly lateness queries</Label>
                <p className="text-xs text-muted-foreground">
                  A Monday cron flags repeat lateness and escalates: 1st = SMS warning, 2nd =
                  written-note query (+ HR task), 3rd = management meeting.
                </p>
              </div>
              <Switch
                id="lateness-enabled"
                checked={cfg.latenessPolicyEnabled}
                onCheckedChange={(v) => set('latenessPolicyEnabled', v)}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="late-flags">Late arrivals per week before a query</Label>
                <p className="text-xs text-muted-foreground">
                  e.g. 3 = being late 3+ times in a week triggers the next query.
                </p>
              </div>
              <Input
                id="late-flags"
                type="number"
                min={1}
                className="w-24"
                value={cfg.lateFlagsPerWeek}
                onChange={(e) => set('lateFlagsPerWeek', Number(e.target.value) as never)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
