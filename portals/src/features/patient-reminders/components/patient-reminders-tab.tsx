import { format } from 'date-fns'
import {
  BellOff,
  ChevronDown,
  FlaskConical,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO } from '@/shared/lib/dates'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReminderTemplate {
  id: string
  name: string
  messageTemplate: string
}

interface ScheduledReminder {
  id: string
  name: string
  scheduledAt: string | null
  messageTemplate: string
  status: string | null
  templateId: string | null
  template: ReminderTemplate | null
  createdBy: { id: string; name: string } | null
  createdAt: string
}

type ReminderStatus = 'pending' | 'sent' | 'cancelled' | 'failed' | 'dev_simulated'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<ReminderStatus, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className:
      'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  sent: {
    label: 'Sent',
    className:
      'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  failed: {
    label: 'Failed',
    className: 'border-transparent bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
  cancelled: {
    label: 'Cancelled',
    className:
      'border-transparent bg-slate-200 text-foreground dark:bg-slate-800 dark:text-slate-300',
  },
  dev_simulated: {
    label: 'Dev (simulated)',
    className:
      'border-transparent bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  },
}

function renderTemplate(template: string, firstName: string, date: string, time: string) {
  const dateFmt = date ? format(new Date(`${date}T${time || '00:00'}`), 'MMMM d, yyyy') : '{date}'
  const timeFmt = time ? format(new Date(`${date || '2000-01-01'}T${time}`), 'h:mm a') : '{time}'
  return template
    .replace(/\{firstName\}/g, firstName || 'there')
    .replace(/\{date\}/g, dateFmt)
    .replace(/\{time\}/g, timeFmt)
    .replace(/\{clinicName\}/g, 'Denel Dental')
}

function _truncate(text: string, max = 60) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  try {
    return format(new Date(iso), 'MMM d, yyyy')
  } catch {
    return iso
  }
}

function fmtTime(iso: string | null) {
  if (!iso) return ''
  try {
    return format(new Date(iso), 'h:mm a')
  } catch {
    return ''
  }
}

// ─── Compose Dialog ───────────────────────────────────────────────────────────

interface ComposeDialogProps {
  patientId: string
  patientFirstName: string
  templates: ReminderTemplate[]
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (r: ScheduledReminder) => void
}

function ComposeDialog({
  patientId,
  patientFirstName,
  templates,
  open,
  onOpenChange,
  onCreated,
}: ComposeDialogProps) {
  const [templateId, setTemplateId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const { isSubmitting, submit } = useSubmitGuard()

  const firstName = patientFirstName.trim() || 'Patient'
  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null

  const preview = useMemo(() => {
    if (!selectedTemplate) return 'Select a template to preview the message.'
    return renderTemplate(selectedTemplate.messageTemplate, firstName, date, time)
  }, [selectedTemplate, firstName, date, time])

  function reset() {
    setTemplateId('')
    setDate('')
    setTime('')
  }

  function handleSave() {
    return submit(async () => {
      if (!templateId) {
        toast.error('Select a template')
        return
      }
      if (!date) {
        toast.error('Date is required')
        return
      }
      if (!time) {
        toast.error('Time is required')
        return
      }
      if (!selectedTemplate) return

      // Guard against scheduling in the past
      const scheduledAt = new Date(`${date}T${time}`)
      if (scheduledAt <= new Date()) {
        toast.error('Scheduled time must be in the future')
        return
      }

      const res = await api.post<ScheduledReminder>('/api/scheduled-reminders', {
        patientId,
        templateId,
        name: selectedTemplate.name,
        // Send the raw template so the scheduler can re-render it with
        // up-to-date patient data at send time. The live preview above already
        // shows the user what the final SMS will look like.
        messageTemplate: selectedTemplate.messageTemplate,
        type: 'patient_specific',
        triggerType: 'on_date',
        scheduledAt: scheduledAt.toISOString(),
        status: 'pending',
      })

      if (res.success && res.data) {
        toast.success('Reminder scheduled')
        onCreated(res.data as ScheduledReminder)
        reset()
        onOpenChange(false)
      } else {
        surfaceApiError(res, 'Failed to schedule reminder')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule SMS Reminder</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Template selector */}
          <div className="space-y-2">
            <Label className="text-xs">Template</Label>
            {templates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No templates available. Ask an admin to create reminder templates in Settings.
              </p>
            ) : (
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Date + time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rm-date" className="text-xs">
                Date
              </Label>
              <Input
                id="rm-date"
                type="date"
                value={date}
                min={localDateISO()}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rm-time" className="text-xs">
                Time
              </Label>
              <Input
                id="rm-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-1.5">
              SMS preview
            </p>
            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
              {preview}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting || !templateId || !date || !time}>
            {isSubmitting ? 'Scheduling…' : 'Schedule reminder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

interface Props {
  patientId: string
  canEdit?: boolean
  isAdmin?: boolean
  patientFirstName?: string
}

export function PatientRemindersTab({
  patientId,
  canEdit = true,
  isAdmin = false,
  patientFirstName = '',
}: Props) {
  const [templates, setTemplates] = useState<ReminderTemplate[]>([])
  const [reminders, setReminders] = useState<ScheduledReminder[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      else setRefreshing(true)
      const [tplRes, remRes] = await Promise.all([
        api.get<ReminderTemplate[]>('/api/lookups/reminder-templates'),
        // Use query-param filter on the list endpoint — a /patient/:id sub-route
        // does not exist; the /:id wildcard would treat 'patient' as a reminder UUID.
        api.get<ScheduledReminder[]>(`/api/scheduled-reminders?patientId=${patientId}`),
      ])
      if (tplRes.success && tplRes.data) setTemplates(tplRes.data as ReminderTemplate[])
      if (remRes.success && remRes.data) setReminders(remRes.data as ScheduledReminder[])
      setLoading(false)
      setRefreshing(false)
    },
    [patientId]
  )

  useEffect(() => {
    load()
  }, [load])

  async function handleTriggerScheduler() {
    setTriggering(true)
    const res = await api.post<{
      processed: number
      report: Array<{ name: string; firedThisTick: boolean; statusAfter: string }>
    }>('/api/diag/run-scheduler', {})
    setTriggering(false)
    if (res.success && res.data) {
      const data = res.data as {
        processed: number
        report: Array<{ name: string; firedThisTick: boolean; statusAfter: string }>
      }
      const fired = data.report.filter((r) => r.firedThisTick)
      if (fired.length > 0) {
        toast.success(`Scheduler ran — ${fired.length} reminder(s) fired`)
      } else {
        toast.info('Scheduler ran — no reminders were due yet')
      }
      await load(true)
    } else {
      surfaceApiError(res, 'Failed to trigger scheduler')
    }
  }

  async function handleCancel(id: string) {
    if (cancellingId) return
    setCancellingId(id)
    const res = await api.patch(`/api/scheduled-reminders/${id}`, { status: 'cancelled' })
    setCancellingId(null)
    if (res.success) {
      toast.success('Reminder cancelled')
      setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r)))
    } else {
      surfaceApiError(res, 'Failed to cancel reminder')
    }
  }

  async function handleDelete(id: string) {
    const res = await api.delete(`/api/scheduled-reminders/${id}`)
    if (res.success) {
      toast.success('Reminder deleted')
      setReminders((prev) => prev.filter((r) => r.id !== id))
      if (expandedId === id) setExpandedId(null)
    } else {
      surfaceApiError(res, 'Failed to delete reminder')
    }
    setDeleteTargetId(null)
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">SMS Reminders</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Template-based patient reminders. Appears in Scheduling → Scheduled Reminders.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => load(true)}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleTriggerScheduler}
              disabled={triggering}
              title="Run the scheduler now (dev/staging only)"
            >
              <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
              {triggering ? 'Running…' : 'Test scheduler'}
            </Button>
          )}
          {canEdit && (
            <Button
              size="sm"
              onClick={() => setComposeOpen(true)}
              disabled={templates.length === 0}
              title={
                templates.length === 0
                  ? 'No templates available — ask an admin to create reminder templates in Settings'
                  : undefined
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New reminder
            </Button>
          )}
        </div>
      </div>

      {/* Reminders table */}
      <div className="rounded-xl border border-border bg-card">
        {loading ? (
          <div className="p-5 space-y-3">
            {(['sk-a', 'sk-b', 'sk-c'] as const).map((k) => (
              <Skeleton key={k} className="h-10 w-full" />
            ))}
          </div>
        ) : reminders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center px-4">
            <BellOff className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No reminders scheduled yet.</p>
            {canEdit && templates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Ask an admin to create reminder templates in Settings before scheduling reminders.
              </p>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-10 text-xs uppercase tracking-wide w-[110px]">
                  Status
                </TableHead>
                <TableHead className="h-10 text-xs uppercase tracking-wide">Template</TableHead>
                <TableHead className="h-10 text-xs uppercase tracking-wide w-[130px]">
                  Scheduled
                </TableHead>
                <TableHead className="h-10 w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reminders.map((r) => {
                const isExpanded = expandedId === r.id
                const status = (r.status ?? 'pending') as ReminderStatus
                const badge = STATUS_BADGE[status] ?? STATUS_BADGE.pending
                return (
                  <Fragment key={r.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      data-state={isExpanded ? 'selected' : undefined}
                    >
                      <TableCell className="py-2.5">
                        <Badge
                          variant="outline"
                          className={cn('text-[10px] font-medium', badge.className)}
                        >
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5 text-sm">
                        <span className="flex items-center gap-2">
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0',
                              isExpanded && 'rotate-180'
                            )}
                          />
                          <span className="truncate">{r.template?.name ?? r.name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5 text-sm tabular-nums">
                        {r.scheduledAt ? (
                          <span className="whitespace-nowrap">
                            {fmtDate(r.scheduledAt)}{' '}
                            <span className="text-muted-foreground">{fmtTime(r.scheduledAt)}</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="More options"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => setExpandedId(isExpanded ? null : r.id)}
                            >
                              View details
                            </DropdownMenuItem>
                            {status === 'pending' && canEdit && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-muted-foreground"
                                  disabled={cancellingId === r.id}
                                  onSelect={() => handleCancel(r.id)}
                                >
                                  <X className="h-3.5 w-3.5 mr-2" />
                                  {cancellingId === r.id ? 'Cancelling…' : 'Cancel'}
                                </DropdownMenuItem>
                              </>
                            )}
                            {isAdmin && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => setDeleteTargetId(r.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={4} className="py-4">
                          <div className="space-y-3 px-2">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-1">
                                Message
                              </p>
                              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                {r.messageTemplate}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                              <div>
                                <p className="uppercase tracking-wide font-medium text-muted-foreground mb-0.5">
                                  Scheduled
                                </p>
                                <p className="tabular-nums">
                                  {r.scheduledAt
                                    ? `${fmtDate(r.scheduledAt)} ${fmtTime(r.scheduledAt)}`
                                    : '—'}
                                </p>
                              </div>
                              <div>
                                <p className="uppercase tracking-wide font-medium text-muted-foreground mb-0.5">
                                  Created
                                </p>
                                <p className="tabular-nums">{fmtDate(r.createdAt)}</p>
                              </div>
                              {r.createdBy && (
                                <div>
                                  <p className="uppercase tracking-wide font-medium text-muted-foreground mb-0.5">
                                    By
                                  </p>
                                  <p>{r.createdBy.name}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <ComposeDialog
        patientId={patientId}
        patientFirstName={patientFirstName}
        templates={templates}
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onCreated={(r) => setReminders((prev) => [r, ...prev])}
      />

      {/* Delete confirmation — fires only after explicit user confirmation */}
      <AlertDialog
        open={deleteTargetId !== null}
        onOpenChange={(v) => {
          if (!v) setDeleteTargetId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete reminder?</AlertDialogTitle>
            <AlertDialogDescription>
              This reminder will be permanently deleted and cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTargetId) handleDelete(deleteTargetId)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
