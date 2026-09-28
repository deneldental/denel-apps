import { AlertTriangle, CalendarCheck, CalendarX, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getPerDoctorCalendarStatus } from '@/lib/actions/google-calendar'
import { type Specialist, updateSpecialist } from '@/lib/actions/specialists'
import { useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'

/** Plain-English copy for the warnings /per-doctor-status returns. */
const WARNING_COPY: Record<string, string> = {
  no_specialist_link: 'This doctor has no specialist record, so events cannot be routed.',
  not_provisioned:
    'No calendar is set. Appointments fall back to the shared clinic calendar until one is.',
  shared_with_fallback:
    'Events are landing on the shared clinic calendar rather than a calendar of their own.',
  shared_with_other_doctor:
    'This calendar is also in use by another doctor — their appointments will be mixed together.',
  observed_mismatch_with_provisioned:
    'Events have landed on a different calendar than the one set here. The link was probably changed after events synced.',
}

/**
 * Per-doctor Google Calendar destination.
 *
 * Appointments sync to the calendar id on the specialist row. When it is empty
 * the service account either auto-provisions one or falls back to the shared
 * clinic calendar — which silently mixes every doctor's appointments together.
 * This tab surfaces which of those is actually happening for this doctor and
 * lets an admin point them at a specific calendar.
 *
 * Read state comes from the same `/per-doctor-status` endpoint the Integrations
 * page uses, so the two never disagree; the write goes through the specialist
 * PATCH.
 */
export function CalendarLinkTab({
  specialist,
  canEdit,
  onChanged,
}: {
  specialist: Specialist
  canEdit: boolean
  onChanged: () => void
}) {
  const [value, setValue] = useState(specialist.gcalCalendarId ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(specialist.gcalCalendarId ?? '')
  }, [specialist.gcalCalendarId])

  // No shared query-key group exists for the Google Calendar audit — local
  // literal, module-scoped.
  const { data, isLoading, refetch } = useApiQuery(
    ['google-calendar', 'per-doctor-status'] as const,
    () => getPerDoctorCalendarStatus()
  )

  const row = data?.rows.find((r) => r.specialistId === specialist.id) ?? null
  const dirty = value.trim() !== (specialist.gcalCalendarId ?? '')

  async function save(next: string | null) {
    setSaving(true)
    const res = await updateSpecialist(specialist.id, { gcalCalendarId: next })
    setSaving(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success(next ? 'Calendar linked' : 'Calendar link cleared')
    onChanged()
    void refetch()
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="h-4 w-4" />
            Google Calendar
          </CardTitle>
          <CardDescription>
            The calendar {specialist.name}'s appointments sync to. Leave empty to let the clinic's
            service account provision one automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gcal-id">Calendar ID</Label>
            <div className="flex gap-2">
              <Input
                id="gcal-id"
                placeholder="name@group.calendar.google.com"
                value={value}
                disabled={!canEdit || saving}
                onChange={(e) => setValue(e.target.value)}
                className="font-mono text-sm"
              />
              {canEdit && (
                <Button onClick={() => save(value.trim() || null)} disabled={!dirty || saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Found in Google Calendar under Settings → Integrate calendar → Calendar ID. The
              clinic's service account must have write access to it.
            </p>
          </div>

          {canEdit && specialist.gcalCalendarId && (
            <Button variant="outline" size="sm" onClick={() => save(null)} disabled={saving}>
              <CalendarX className="mr-2 h-3.5 w-3.5" />
              Clear link
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sync status</CardTitle>
          <CardDescription>Where this doctor's appointments are actually landing.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !row ? (
            <p className="text-sm italic text-muted-foreground">
              No sync activity recorded for this specialist yet.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Events synced</p>
                  <p className="font-mono text-lg">{row.eventCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last synced</p>
                  <p className="text-sm">
                    {row.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString() : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Observed calendars</p>
                  <p className="truncate font-mono text-xs">
                    {row.observedCalendarIds.length > 0 ? row.observedCalendarIds.join(', ') : '—'}
                  </p>
                </div>
              </div>

              {row.warnings.length > 0 ? (
                <div className="space-y-2">
                  {row.warnings.map((w) => (
                    <div
                      key={w}
                      className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm dark:bg-amber-950/20"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span>{WARNING_COPY[w] ?? w}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Badge variant="secondary">Syncing normally</Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
