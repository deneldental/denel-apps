import { Save } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { SettingsLoadError } from '@/features/settings/components/settings-load-error'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'
import { useKvSetting } from '@/shared/hooks/use-kv-setting'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'

type DaySchedule = {
  open: boolean
  openTime: string
  closeTime: string
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
type Day = (typeof DAYS)[number]

type OperatingHours = Record<Day, DaySchedule>

const DEFAULT_DAY: DaySchedule = {
  open: true,
  openTime: '08:00',
  closeTime: '17:00',
}

const DEFAULT: OperatingHours = DAYS.reduce((acc, d) => {
  acc[d] = { ...DEFAULT_DAY, open: d !== 'sunday' }
  return acc
}, {} as OperatingHours)

export function OperatingHoursSection() {
  const {
    value: hours,
    setValue: setHours,
    loading,
    loadError,
    canSave,
    isDirty,
    save,
    refetch,
  } = useKvSetting<OperatingHours>('operating_hours', DEFAULT, {
    // Merge per-day so a null/missing entry from the server doesn't wipe out
    // a default and crash the renderer.
    fromStored: (stored) => {
      const incoming = (stored ?? {}) as Partial<Record<Day, Partial<DaySchedule>>>
      return DAYS.reduce<OperatingHours>(
        (acc, d) => {
          const day = incoming[d]
          acc[d] = day ? { ...DEFAULT[d], ...day } : DEFAULT[d]
          return acc
        },
        { ...DEFAULT }
      )
    },
  })
  const { isSubmitting, submit } = useSubmitGuard()

  // beforeunload guard — warns the user if they navigate away with unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  function updateDay(day: Day, patch: Partial<DaySchedule>) {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }))
  }

  const TIME_RE = /^\d{2}:\d{2}$/

  function validate(): string | null {
    for (const day of DAYS) {
      const sched = hours[day]
      if (!sched.open) continue
      if (!TIME_RE.test(sched.openTime) || !TIME_RE.test(sched.closeTime)) {
        return `${day.charAt(0).toUpperCase() + day.slice(1)}: open and close times are required.`
      }
      if (sched.closeTime <= sched.openTime) {
        return `${day.charAt(0).toUpperCase() + day.slice(1)}: close time must be after open time.`
      }
    }
    return null
  }

  function handleSave() {
    submit(async () => {
      const validationError = validate()
      if (validationError) {
        toast.error(validationError)
        return
      }
      try {
        await save()
        toast.success('Operating hours saved')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  if (loading) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-4">
      <SettingsLoadError error={loadError} onRetry={refetch} />
      <div>
        <h2 className="text-lg font-semibold">Operating Hours</h2>
        <p className="text-xs text-muted-foreground">
          Clinic hours per day, kept as clinic profile information. Nothing schedules or sends
          reminders against them yet.
        </p>
      </div>

      <div className="space-y-2">
        {DAYS.map((day) => {
          const sched = hours[day] ?? DEFAULT_DAY
          return (
            <div key={day} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium capitalize">{day}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {sched.open ? 'Open' : 'Closed'}
                  </span>
                  <Switch
                    checked={sched.open}
                    onCheckedChange={(v) => updateDay(day, { open: v })}
                    aria-label={`${day.charAt(0).toUpperCase() + day.slice(1)} – ${sched.open ? 'Open' : 'Closed'}`}
                  />
                </div>
              </div>
              {sched.open && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`${day}-open-time`} className="text-[10px]">
                      Open
                    </Label>
                    <Input
                      id={`${day}-open-time`}
                      type="time"
                      value={sched.openTime}
                      onChange={(e) => updateDay(day, { openTime: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${day}-close-time`} className="text-[10px]">
                      Close
                    </Label>
                    <Input
                      id={`${day}-close-time`}
                      type="time"
                      value={sched.closeTime}
                      onChange={(e) => updateDay(day, { closeTime: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!canSave || isSubmitting}>
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {isSubmitting ? 'Saving…' : 'Save Hours'}
        </Button>
      </div>
    </div>
  )
}
