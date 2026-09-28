import { formatDistanceToNow, parseISO } from 'date-fns'
import { Send, Trash2 } from 'lucide-react'
import { type ComponentType, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { CampaignEntry, CampaignStatus } from '@/lib/actions/crm'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { SmsComposerSheet } from './sms-composer-sheet'

interface CampaignPageShellProps {
  title: string
  subtitle?: string
  icon?: ComponentType<{ className?: string }>
  contextColumnLabel: string
  entries: CampaignEntry[]
  loading?: boolean
  buildMessage: (entry: CampaignEntry) => string
  buildBulkMessage: (entries: CampaignEntry[]) => string
}

const STATUS_VARIANT: Record<
  CampaignStatus,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  pending: 'warning',
  sent: 'success',
  dismissed: 'outline',
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  dismissed: 'Dismissed',
}

interface ComposerTarget {
  kind: 'single' | 'bulk'
  entryIds: string[]
  recipientLabel: string
  message: string
}

export function CampaignPageShell({
  title,
  subtitle,
  icon: Icon,
  contextColumnLabel,
  entries,
  loading = false,
  buildMessage,
  buildBulkMessage,
}: CampaignPageShellProps) {
  const [rows, setRows] = useState<CampaignEntry[]>(entries)
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [composer, setComposer] = useState<ComposerTarget | null>(null)

  // Sync rows when entries prop changes (after async load)
  useMemo(() => {
    setRows(entries)
  }, [entries])

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromTs = fromDate ? new Date(fromDate).getTime() : null
    const toTs = toDate ? new Date(toDate).getTime() + 24 * 60 * 60 * 1000 - 1 : null
    return rows.filter((r) => {
      if (
        q &&
        !r.patientName.toLowerCase().includes(q) &&
        !r.phone.toLowerCase().includes(q) &&
        !r.context.toLowerCase().includes(q)
      ) {
        return false
      }
      if (fromTs || toTs) {
        if (!r.dueAt) return false
        const ts = new Date(r.dueAt).getTime()
        if (fromTs && ts < fromTs) return false
        if (toTs && ts > toTs) return false
      }
      return true
    })
  }, [rows, search, fromDate, toDate])

  const pendingCount = rows.filter((r) => r.status === 'pending').length

  const markSent = (ids: string[]) => {
    setRows((prev) =>
      prev.map((r) => (ids.includes(r.id) ? { ...r, status: 'sent' as CampaignStatus } : r))
    )
  }

  const handleDismiss = (entry: CampaignEntry) => {
    setRows((prev) =>
      prev.map((r) => (r.id === entry.id ? { ...r, status: 'dismissed' as CampaignStatus } : r))
    )
    toast.message(`Dismissed ${entry.patientName}`)
  }

  const openSingleComposer = (entry: CampaignEntry) => {
    setComposer({
      kind: 'single',
      entryIds: [entry.id],
      recipientLabel: entry.patientName,
      message: buildMessage(entry),
    })
  }

  const openBulkComposer = () => {
    const targets = visibleRows.filter((r) => r.status === 'pending')
    if (targets.length === 0) {
      toast.error('No pending recipients to send to')
      return
    }
    setComposer({
      kind: 'bulk',
      entryIds: targets.map((t) => t.id),
      recipientLabel: `${targets.length} ${targets.length === 1 ? 'patient' : 'patients'}`,
      message: buildBulkMessage(targets),
    })
  }

  const handleComposerSend = () => {
    if (!composer) return
    markSent(composer.entryIds)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {Icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Badge variant={pendingCount > 0 ? 'warning' : 'secondary'} className="text-sm">
          {pendingCount} pending
        </Badge>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <label
                htmlFor="campaign-search"
                className="text-xs font-medium text-muted-foreground"
              >
                Search
              </label>
              <Input
                id="campaign-search"
                placeholder="Patient, phone, or context…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="campaign-from" className="text-xs font-medium text-muted-foreground">
                From
              </label>
              <Input
                id="campaign-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="campaign-to" className="text-xs font-medium text-muted-foreground">
                To
              </label>
              <Input
                id="campaign-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <Button onClick={openBulkComposer} className="sm:self-end">
              <Send className="mr-2 h-4 w-4" />
              Send to all
            </Button>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>{contextColumnLabel}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : visibleRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No entries match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.patientName}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.phone}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{row.context}</span>
                          {row.dueAt && (
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(parseISO(row.dueAt), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[row.status]}>
                          {STATUS_LABEL[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openSingleComposer(row)}
                            disabled={row.status !== 'pending'}
                          >
                            <Send className="mr-1.5 h-3.5 w-3.5" />
                            Send SMS
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDismiss(row)}
                            disabled={row.status === 'dismissed'}
                            aria-label={`Dismiss ${row.patientName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <SmsComposerSheet
        open={composer !== null}
        onOpenChange={(open) => {
          if (!open) setComposer(null)
        }}
        recipientLabel={composer?.recipientLabel ?? ''}
        defaultMessage={composer?.message ?? ''}
        onSend={handleComposerSend}
      />
    </div>
  )
}
