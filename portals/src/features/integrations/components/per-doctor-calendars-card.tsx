// Integrations → Google Calendar → Per-doctor calendars (SA mode only).
//
// Auditing surface for the per-specialist calendar provisioning that
// happens automatically on first sync. Each row shows:
//   - Doctor name + which calendar id their events are landing on.
//   - Event count + last sync timestamp.
//   - Warnings when something is off:
//       • "Not provisioned" — first sync hasn't fired yet.
//       • "Going to shared fallback" — doctor has no specialist link, so
//         events land on the SA's shared calendar instead of an isolated
//         per-doctor calendar.
//       • "Shared with another doctor" — same calendar id appears on more
//         than one doctor (should never happen; flag it loudly).
//       • "Observed ≠ provisioned" — old events on a different calendar
//         than the one currently provisioned (mid-flight migration leftover).

import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react'
import {
  getPerDoctorCalendarStatus,
  type PerDoctorCalendarStatus,
  type PerDoctorCalendarWarning,
} from '@/lib/actions/google-calendar'
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
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

const WARNING_LABELS: Record<PerDoctorCalendarWarning, string> = {
  no_specialist_link: 'No specialist link',
  not_provisioned: 'Not yet provisioned',
  shared_with_fallback: 'Going to shared fallback',
  shared_with_other_doctor: 'Shared with another doctor',
  observed_mismatch_with_provisioned: 'Observed ≠ provisioned',
}

const WARNING_TONE: Record<PerDoctorCalendarWarning, 'amber' | 'red'> = {
  no_specialist_link: 'red',
  not_provisioned: 'amber',
  shared_with_fallback: 'red',
  shared_with_other_doctor: 'red',
  observed_mismatch_with_provisioned: 'amber',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface Props {
  /** Hide the card when SA isn't the active auth method — per-doctor calendars
   *  are only auto-provisioned in service-account mode. */
  visible: boolean
}

const PER_DOCTOR_CALENDARS_KEY = ['integrations', 'google-calendar', 'per-doctor-status'] as const

export function PerDoctorCalendarsCard({ visible }: Props) {
  const query = useApiQuery(PER_DOCTOR_CALENDARS_KEY, getPerDoctorCalendarStatus, {
    enabled: visible,
  })
  const data: PerDoctorCalendarStatus | null = query.data ?? null
  const loading = query.isLoading
  const fetching = query.isFetching
  const error = query.isError
    ? query.error instanceof Error
      ? query.error.message
      : 'Failed to load'
    : null

  if (!visible) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Per-doctor calendars</CardTitle>
            <CardDescription>
              Each doctor should land on their own auto-provisioned Google calendar in SA mode. Rows
              here surface drift: missing provisioning, fallback usage, or two doctors sharing the
              same calendar.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={fetching}
            aria-label="Refresh"
          >
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
            <Button
              size="sm"
              variant="outline"
              className="ml-3"
              onClick={() => {
                void query.refetch()
              }}
            >
              Retry
            </Button>
          </div>
        ) : !data || data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No doctors found. Add doctors via the Staff or Specialists module.
          </p>
        ) : (
          <>
            {data.sharedFallbackCalendarId && (
              <p className="text-[11px] text-muted-foreground mb-3">
                Shared fallback calendar:{' '}
                <code className="font-mono text-foreground">{data.sharedFallbackCalendarId}</code>
              </p>
            )}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Calendar id</TableHead>
                    <TableHead className="text-right">Events</TableHead>
                    <TableHead>Last sync</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row) => {
                    const provisionedShort = row.provisionedCalendarId
                      ? row.provisionedCalendarId.split('@')[0].slice(0, 18) +
                        (row.provisionedCalendarId.length > 18 ? '…' : '')
                      : '—'
                    const ok = row.warnings.length === 0
                    return (
                      <TableRow key={row.doctorId}>
                        <TableCell className="font-medium">{row.doctorName}</TableCell>
                        <TableCell
                          className="font-mono text-xs"
                          title={row.provisionedCalendarId ?? undefined}
                        >
                          {provisionedShort}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.eventCount}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(row.lastSyncedAt)}
                        </TableCell>
                        <TableCell>
                          {ok ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-4 px-1.5 border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                            >
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              Isolated
                            </Badge>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {row.warnings.map((w) => (
                                <Badge
                                  key={w}
                                  variant="outline"
                                  className={`text-[10px] h-4 px-1.5 ${
                                    WARNING_TONE[w] === 'red'
                                      ? 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                                      : 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
                                  }`}
                                >
                                  <AlertTriangle className="mr-1 h-3 w-3" />
                                  {WARNING_LABELS[w]}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
