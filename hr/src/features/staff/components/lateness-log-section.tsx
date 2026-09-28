// Attendance › Lateness Log.
//
// Two views of the same policy, side by side:
//   • "Per staff" — who was late, how often, and where they now sit on the
//     cumulative escalation ladder (level 1 SMS → 2 written warning → 3 meeting).
//   • "Query & SMS log" — every query the weekly cron issued, with what the
//     alert SMS actually did. A failed send is visible instead of silent.
//
// Read-only: the escalation is the weekly `lateness-policy` cron's job, this
// tab is the record of it. Late-day counts follow the selected month; the
// escalation level is cumulative and all-time by design.

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  StatCard,
} from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, CalendarClock, Clock, MessageSquare, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  getLatenessLog,
  type LatenessLog,
  type LatenessLogEntry,
  type LatenessStaffRow,
} from '@/lib/actions/staff'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const LEVEL_LABEL: Record<number, string> = {
  1: 'Level 1 · SMS warning',
  2: 'Level 2 · Written warning',
  3: 'Level 3 · Management meeting',
}

/** Escalation reads as severity, so it belongs on the traffic-light scale. */
function LevelBadge({ level }: { level: number }) {
  if (!level) return <span className="text-muted-foreground text-sm">—</span>
  return (
    <StatusBadge tone={level >= 3 ? 'danger' : level === 2 ? 'warning' : 'neutral'}>
      {LEVEL_LABEL[level] ?? `Level ${level}`}
    </StatusBadge>
  )
}

/** Null status = the query predates SMS tracking, which is not the same as failed. */
function SmsBadge({ entry }: { entry: LatenessLogEntry }) {
  if (entry.smsStatus === 'sent')
    return (
      <StatusBadge tone="success">
        Sent{entry.smsSentAt ? ` · ${format(parseISO(entry.smsSentAt), 'MMM d, HH:mm')}` : ''}
      </StatusBadge>
    )
  if (entry.smsStatus === 'failed') return <StatusBadge tone="danger">Failed</StatusBadge>
  if (entry.smsStatus === 'no_phone') return <StatusBadge tone="warning">No phone</StatusBadge>
  return <StatusBadge tone="neutral">Not recorded</StatusBadge>
}

export function LatenessLogSection() {
  const [month, setMonth] = useState(currentMonth())
  const [history, setHistory] = useState<'month' | 'all'>('month')
  const [log, setLog] = useState<LatenessLog | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void getLatenessLog(month, history).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setLog(res.data)
      } else {
        toast.error(res.error || 'Failed to load the lateness log')
        setLog(null)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [month, history])

  const rows = log?.rows ?? []
  const entries = log?.entries ?? []

  // Staff with nothing to show would be most of the table — list only those
  // with lateness this month or a standing query, and count the rest.
  const activeRows = useMemo(
    () =>
      rows
        .filter((r) => r.lateDays > 0 || r.totalQueries > 0)
        .sort((a, b) => b.lateDays - a.lateDays || b.currentLevel - a.currentLevel),
    [rows]
  )
  const cleanCount = rows.length - activeRows.length

  const totals = useMemo(
    () => ({
      lateStaff: rows.filter((r) => r.lateDays > 0).length,
      lateDays: rows.reduce((sum, r) => sum + r.lateDays, 0),
      queries: rows.reduce((sum, r) => sum + r.queriesInMonth, 0),
      smsSent: entries.filter((e) => e.smsStatus === 'sent').length,
      smsFailed: entries.filter((e) => e.smsStatus === 'failed' || e.smsStatus === 'no_phone')
        .length,
    }),
    [rows, entries]
  )

  const staffColumns = useMemo<ColumnDef<LatenessStaffRow>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
        cell: ({ row }) =>
          row.original.role ? (
            <TagBadge className="capitalize">{row.original.role.replace(/_/g, ' ')}</TagBadge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'lateDays',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Late days" />,
        cell: ({ row }) => (
          <span
            className="tabular-nums font-medium"
            // The dates behind the count, so HR doesn't have to open the
            // per-staff drilldown to sanity-check a number.
            title={row.original.lateDates
              .map((d) => `${d.date}${d.clockIn ? ` · in ${d.clockIn}` : ''}`)
              .join('\n')}
          >
            {row.original.lateDays}
          </span>
        ),
      },
      {
        accessorKey: 'queriesInMonth',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Queries" />,
        cell: ({ row }) => <span className="tabular-nums">{row.original.queriesInMonth}</span>,
      },
      {
        accessorKey: 'smsSentInMonth',
        header: ({ column }) => <DataTableColumnHeader column={column} title="SMS sent" />,
        cell: ({ row }) => {
          const r = row.original
          return (
            <span className="flex items-center gap-2 tabular-nums">
              {r.smsSentInMonth}
              {r.queriesInMonth > r.smsSentInMonth && (
                <StatusBadge tone="danger">
                  {r.queriesInMonth - r.smsSentInMonth} unsent
                </StatusBadge>
              )}
            </span>
          )
        },
      },
      {
        accessorKey: 'currentLevel',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Standing" />,
        cell: ({ row }) => <LevelBadge level={row.original.currentLevel} />,
      },
      {
        accessorKey: 'lastQueryWeek',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last query" />,
        cell: ({ row }) =>
          row.original.lastQueryWeek ? (
            <span className="text-sm">
              week of {format(parseISO(row.original.lastQueryWeek), 'MMM d, yyyy')}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">Never</span>
          ),
      },
      {
        id: 'phone',
        header: 'Phone',
        cell: ({ row }) =>
          row.original.phone ? (
            <span className="font-mono text-xs">{row.original.phone}</span>
          ) : (
            <StatusBadge tone="warning">No phone</StatusBadge>
          ),
      },
    ],
    []
  )

  const entryColumns = useMemo<ColumnDef<LatenessLogEntry>[]>(
    () => [
      {
        accessorKey: 'weekStart',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Week" />,
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap">
            {format(parseISO(row.original.weekStart), 'MMM d, yyyy')}
          </span>
        ),
      },
      {
        accessorKey: 'fullName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Staff" />,
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      {
        accessorKey: 'lateCount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Late days" />,
        cell: ({ row }) => <span className="tabular-nums">{row.original.lateCount}</span>,
      },
      {
        accessorKey: 'level',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Level" />,
        cell: ({ row }) => <LevelBadge level={row.original.level} />,
      },
      {
        id: 'sms',
        header: 'Alert SMS',
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <SmsBadge entry={row.original} />
            {row.original.smsRecipient && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {row.original.smsRecipient}
              </span>
            )}
            {row.original.smsError && (
              <span className="text-[11px] text-destructive">{row.original.smsError}</span>
            )}
          </div>
        ),
      },
      {
        id: 'message',
        header: 'Message',
        cell: ({ row }) =>
          row.original.smsMessage ? (
            <span
              className="block max-w-[380px] truncate text-sm text-muted-foreground"
              title={row.original.smsMessage}
            >
              {row.original.smsMessage}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Issued" />,
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {format(parseISO(row.original.createdAt), 'MMM d, HH:mm')}
          </span>
        ),
      },
    ],
    []
  )

  return (
    <div className="space-y-6">
      {log && !log.config.latenessPolicyEnabled && (
        <Alert appearance="light">
          <AlertDescription className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              The weekly lateness policy is <strong>off</strong>, so no lateness SMS are being sent.
              Late days below are still counted — turn the policy on under the{' '}
              <strong>Scoring</strong> tab to resume alerts.
            </span>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Staff late this month"
          value={totals.lateStaff}
          icon={<Users />}
          variant="amber"
          hint={`${totals.lateDays} late day${totals.lateDays === 1 ? '' : 's'} in total`}
        />
        <StatCard
          title="Queries issued"
          value={totals.queries}
          icon={<AlertTriangle />}
          variant="rose"
          hint={log ? `Threshold: ${log.config.lateFlagsPerWeek} late days in a week` : 'Loading…'}
        />
        <StatCard
          title="Alert SMS sent"
          value={totals.smsSent}
          icon={<MessageSquare />}
          variant="green"
          hint={history === 'all' ? 'All time' : 'This month'}
        />
        <StatCard
          title="SMS not delivered"
          value={totals.smsFailed}
          icon={<Clock />}
          variant={totals.smsFailed > 0 ? 'rose' : 'slate'}
          hint={totals.smsFailed > 0 ? 'Failed or missing phone' : 'Nothing outstanding'}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarClock className="h-5 w-5" />
              Lateness per staff
            </CardTitle>
            <CardDescription>
              Late days counted for {month}, alongside each person's standing on the cumulative
              escalation ladder.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lateness-month" className="text-xs">
              Month
            </Label>
            <Input
              id="lateness-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value || currentMonth())}
              className="w-[150px]"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : activeRows.length > 0 ? (
            <>
              <DataTable columns={staffColumns} data={activeRows} />
              {cleanCount > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {cleanCount} other tracked staff had no lateness in {month} and no standing query.
                </p>
              )}
            </>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              No lateness recorded for {month}.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageSquare className="h-5 w-5" />
              Query &amp; SMS log
            </CardTitle>
            <CardDescription>
              Every lateness query the weekly policy issued, with the alert SMS it sent.
            </CardDescription>
          </div>
          <div className="inline-flex rounded-md border p-0.5">
            {(
              [
                { id: 'month', label: 'This month' },
                { id: 'all', label: 'All time' },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                variant={history === opt.id ? 'default' : 'ghost'}
                className="h-8 px-3"
                onClick={() => setHistory(opt.id)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : entries.length > 0 ? (
            <DataTable columns={entryColumns} data={entries} />
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              {history === 'all'
                ? 'No lateness queries have been issued yet.'
                : `No lateness queries issued for ${month}.`}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
