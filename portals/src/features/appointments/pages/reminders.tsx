import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { format, parseISO } from 'date-fns'
import { ListFilter, Loader2, Plus, Send, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { SmsComposerSheet } from '@/features/crm/components/sms-composer-sheet'
import { ActionItemsCard } from '@/features/dashboard/components/action-items-card'
import { fetchActionItems } from '@/features/dashboard/hooks/use-action-items'
import type { ActionItemsData, AlertsPayload, OverduePaymentPlan } from '@/features/dashboard/types'
import {
  type CampaignEntry,
  getCrmBirthdays,
  getCrmFollowUps,
  getCrmRecareDue,
} from '@/lib/actions/crm'
import { getBirthdaysAndFollowups } from '@/lib/actions/dashboard'
import { getOverduePaymentPlans } from '@/lib/actions/payment-plans'
import { api } from '@/lib/api-client'
import { useBranding } from '@/lib/branding-context'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { PatientPicker, type PickerPatient } from '@/shared/components/patient-picker'
import { Badge } from '@/shared/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/components/ui/breadcrumb'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageType = 'reminder' | 'recare' | 'follow-up' | 'birthday'

type MessageRow = {
  id: string
  patientName: string
  phone: string
  type: MessageType
  context: string
  dueAt: string | null
  status: string
  defaultMessage: string
}

type ScheduledReminder = {
  id: string
  name: string
  status: string
  scheduledAt: string | null
  messageTemplate: string
  patient: { id: string; name: string; patientId: string | null } | null
  template: { id: string; name: string } | null
}

type ReminderTemplate = {
  id: string
  name: string
  messageTemplate: string
}

const TYPE_LABELS: Record<MessageType, string> = {
  reminder: 'Reminder',
  recare: 'Recare',
  'follow-up': 'Follow-up',
  birthday: 'Birthday',
}

const TYPE_VARIANTS: Record<MessageType, 'default' | 'secondary' | 'outline' | 'warning'> = {
  reminder: 'default',
  recare: 'warning',
  'follow-up': 'secondary',
  birthday: 'outline',
}

const STATUS_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive' | 'success'
> = {
  pending: 'secondary',
  sent: 'success',
  failed: 'destructive',
  cancelled: 'outline',
  dismissed: 'outline',
}

// ─── Normalization ─────────────────────────────────────────────────────────────

function interpolate(template: string, patientName: string): string {
  return template
    .replace(/\{\{?\s*patient_name\s*\}?\}/gi, patientName)
    .replace(/\{\{?\s*name\s*\}?\}/gi, patientName)
}

function remindersToRows(reminders: ScheduledReminder[], _clinicName: string): MessageRow[] {
  return reminders.map((r) => {
    const patientName = r.patient?.name ?? r.name
    return {
      id: r.id,
      patientName,
      phone: '',
      type: 'reminder',
      context: r.template?.name ?? 'Custom reminder',
      dueAt: r.scheduledAt,
      status: r.status,
      defaultMessage: interpolate(r.messageTemplate ?? '', patientName),
    }
  })
}

function campaignToRows(
  entries: CampaignEntry[],
  type: MessageType,
  buildMsg: (e: CampaignEntry) => string
): MessageRow[] {
  return entries.map((e) => ({
    id: `${type}-${e.id}`,
    patientName: e.patientName,
    phone: e.phone,
    type,
    context: e.context,
    dueAt: e.dueAt,
    status: e.status,
    defaultMessage: buildMsg(e),
  }))
}

// ─── Faceted filter helpers ───────────────────────────────────────────────────

interface FacetedFilterProps<TData, TValue> {
  column: import('@tanstack/react-table').Column<TData, TValue>
  options: Array<{ value: string; label: string }>
}

function FacetedFilter<TData, TValue>({ column, options }: FacetedFilterProps<TData, TValue>) {
  const selected = (column.getFilterValue() as string[] | undefined) ?? []

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-6 p-0 ${selected.length ? 'text-primary' : 'text-muted-foreground'}`}
        >
          <ListFilter className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map(({ value, label }) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={selected.includes(value)}
            onCheckedChange={(on) => {
              const next = on ? [...selected, value] : selected.filter((v) => v !== value)
              column.setFilterValue(next.length ? next : undefined)
            }}
          >
            {label}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => column.setFilterValue(undefined)}>
              <X className="mr-2 h-3 w-3" />
              Clear
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Column definitions ───────────────────────────────────────────────────────

function buildColumns(
  onSend: (row: MessageRow) => void,
  onDelete: (row: MessageRow) => void,
  onDismiss: (row: MessageRow) => void
): ColumnDef<MessageRow>[] {
  return [
    {
      accessorKey: 'patientName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Patient" />,
      cell: ({ row }) => <span className="font-medium">{row.getValue('patientName')}</span>,
    },
    {
      accessorKey: 'type',
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <DataTableColumnHeader column={column} title="Type" />
          <FacetedFilter
            column={column}
            options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>
      ),
      cell: ({ row }) => {
        const type = row.getValue('type') as MessageType
        return (
          <Badge variant={TYPE_VARIANTS[type]} className="text-xs capitalize">
            {TYPE_LABELS[type]}
          </Badge>
        )
      },
      filterFn: (row, id, values: string[]) => {
        if (!values?.length) return true
        return values.includes(row.getValue(id))
      },
    },
    {
      accessorKey: 'context',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Context" />,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.getValue('context')}</span>
      ),
    },
    {
      accessorKey: 'dueAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Scheduled / Due" />,
      cell: ({ row }) => {
        const val = row.getValue('dueAt') as string | null
        if (!val) return <span className="text-muted-foreground">—</span>
        return (
          <span className="text-sm tabular-nums">
            {format(parseISO(val), 'MMM d, yyyy · h:mm a')}
          </span>
        )
      },
      sortingFn: 'datetime',
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <DataTableColumnHeader column={column} title="Status" />
          <FacetedFilter
            column={column}
            options={['pending', 'sent', 'failed', 'cancelled', 'dismissed'].map((s) => ({
              value: s,
              label: s.charAt(0).toUpperCase() + s.slice(1),
            }))}
          />
        </div>
      ),
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        return (
          <Badge variant={STATUS_VARIANTS[status] ?? 'secondary'} className="text-xs capitalize">
            {status}
          </Badge>
        )
      },
      filterFn: (row, id, values: string[]) => {
        if (!values?.length) return true
        return values.includes(row.getValue(id))
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const r = row.original
        const isCampaign = r.type !== 'reminder'
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => onSend(r)}
              disabled={r.status === 'sent' || r.status === 'dismissed' || r.status === 'cancelled'}
            >
              <Send className="mr-1 h-3 w-3" />
              Send
            </Button>
            {isCampaign ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Dismiss"
                disabled={r.status === 'dismissed'}
                onClick={() => onDismiss(r)}
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive hover:text-destructive"
                title="Delete reminder"
                onClick={() => onDelete(r)}
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]
}

// ─── Schedule Reminder Sheet ──────────────────────────────────────────────────

interface ScheduleSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  templates: ReminderTemplate[]
  onCreated: () => void
}

function ScheduleSheet({ open, onOpenChange, templates, onCreated }: ScheduleSheetProps) {
  const [patient, setPatient] = useState<PickerPatient | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setPatient(null)
    setTemplateId('')
    setScheduledAt('')
  }

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  async function handleSave() {
    if (!patient) {
      toast.error('Select a patient')
      return
    }
    if (!templateId) {
      toast.error('Select a message template')
      return
    }
    if (!scheduledAt) {
      toast.error('Set a scheduled date & time')
      return
    }

    const template = templates.find((t) => t.id === templateId)
    const name = `${patient.name} — ${template?.name ?? 'Reminder'}`

    setSaving(true)
    const res = await api.post('/api/scheduled-reminders', {
      name,
      type: 'patient_specific',
      triggerType: 'on_date',
      scheduledAt,
      messageTemplate: template?.messageTemplate ?? '',
      isActive: true,
      status: 'pending',
      patientId: patient.id,
      templateId,
    })
    setSaving(false)

    if (res.success) {
      toast.success('Reminder scheduled')
      onOpenChange(false)
      onCreated()
    } else {
      toast.error('Failed to schedule reminder')
    }
  }

  const selectedTemplate = templates.find((t) => t.id === templateId)
  const preview = selectedTemplate
    ? interpolate(selectedTemplate.messageTemplate, patient?.name ?? '[patient name]')
    : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="!w-full !max-w-[480px] overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>Schedule a Reminder</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 pb-6">
          <div className="space-y-1.5">
            <Label htmlFor="sr-patient">Patient</Label>
            <PatientPicker
              id="sr-patient"
              value={patient?.id ?? ''}
              onChange={(_id, p) => setPatient(p)}
              popoverWidthClass="w-[420px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Message Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 && (
                  <SelectItem value="__none__" disabled>
                    No templates available
                  </SelectItem>
                )}
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preview && (
              <div className="space-y-1">
                <div className="rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 px-3 py-2.5 text-xs leading-relaxed text-blue-900 dark:text-blue-100 whitespace-pre-wrap">
                  {preview}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {preview.length} chars · {Math.max(1, Math.ceil(preview.length / 160))} SMS
                  segment{Math.ceil(preview.length / 160) > 1 ? 's' : ''}
                  {!patient && (
                    <span className="ml-1 text-amber-700">
                      (select a patient to fill placeholders)
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sr-at">Send At</Label>
            <Input
              id="sr-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
        </div>

        <SheetFooter>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Schedule Reminder
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const EMPTY_ACTION_ITEMS: ActionItemsData = {
  recalls: [],
  reminders: [],
  unconfirmedAppts: [],
}
const EMPTY_ALERTS: AlertsPayload = { birthdays: [], followups: [] }

// No shared query-key group exists for either read — both combine several
// `lib/actions`/`api` calls into one derived shape, so these are local,
// module-scoped literals rather than an addition to queryKeys. The messages
// key is a function because the row copy (recall/follow-up/birthday message
// bodies) is templated with `branding.name`, and the old effect refetched
// whenever that changed — folding it into the key preserves that.
const remindersActivitiesKey = ['reminders', 'activities'] as const
const remindersMessagesKey = (brandName: string) => ['reminders', 'messages', brandName] as const

import { Navigate } from 'react-router-dom'
import { usePermissions } from '@/shared/hooks/use-permissions'

export default function ScheduledRemindersPage() {
  const { hasPermission, isLoading: permsLoading } = usePermissions()
  const branding = useBranding()
  const queryClient = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [composer, setComposer] = useState<{ recipientLabel: string; message: string } | null>(null)

  // Activities feed (mirrors the dashboard ActionItemsCard).
  const activitiesQuery = useQuery({
    queryKey: remindersActivitiesKey,
    queryFn: async () => {
      const [items, birthdaysRes, overdueRes] = await Promise.all([
        fetchActionItems(true),
        getBirthdaysAndFollowups(),
        getOverduePaymentPlans(),
      ])
      return {
        actionItems: items ?? EMPTY_ACTION_ITEMS,
        alerts: (birthdaysRes as AlertsPayload) ?? EMPTY_ALERTS,
        overduePayments: (overdueRes as OverduePaymentPlan[]) ?? [],
      }
    },
  })
  const actionItems = activitiesQuery.data?.actionItems ?? EMPTY_ACTION_ITEMS
  const alerts = activitiesQuery.data?.alerts ?? EMPTY_ALERTS
  const overduePayments = activitiesQuery.data?.overduePayments ?? []
  const activitiesLoading = activitiesQuery.isLoading

  const messagesKey = remindersMessagesKey(branding.name)
  const messagesQuery = useQuery({
    queryKey: messagesKey,
    queryFn: async () => {
      const buildRecallMsg = (e: CampaignEntry) =>
        `Hi ${e.patientName}, this is a reminder from ${branding.name}. Your routine checkup is due — please call us or reply BOOK to schedule an appointment.`
      const buildFollowUpMsg = (e: CampaignEntry) =>
        `Hello ${e.patientName}, this is ${branding.name}. We hope you're recovering well after your recent visit. Please reply if you have any concerns.`
      const buildBirthdayMsg = (e: CampaignEntry) =>
        `Happy birthday, ${e.patientName}! Wishing you a year of smiles from all of us at ${branding.name}.`

      const [remRes, tplRes, recallRes, followUpRes, bdRes] = await Promise.all([
        api.get<ScheduledReminder[]>('/api/scheduled-reminders'),
        api.get<ReminderTemplate[]>('/api/reminder-templates'),
        getCrmRecareDue(),
        getCrmFollowUps(),
        getCrmBirthdays(),
      ])

      const templates = tplRes.success && tplRes.data ? tplRes.data : []

      const rows: MessageRow[] = [
        ...(remRes.success && remRes.data ? remindersToRows(remRes.data, branding.name) : []),
        ...(recallRes.success && recallRes.data
          ? campaignToRows(recallRes.data, 'recare', buildRecallMsg)
          : []),
        ...(followUpRes.success && followUpRes.data
          ? campaignToRows(followUpRes.data, 'follow-up', buildFollowUpMsg)
          : []),
        ...(bdRes.success && bdRes.data
          ? campaignToRows(bdRes.data, 'birthday', buildBirthdayMsg)
          : []),
      ]

      return { rows, templates }
    },
  })
  const rows = messagesQuery.data?.rows ?? []
  const templates = messagesQuery.data?.templates ?? []
  const loading = messagesQuery.isLoading

  function handleSend(row: MessageRow) {
    setComposer({ recipientLabel: row.patientName, message: row.defaultMessage })
  }

  function handleComposerSend() {
    // Mark the row as sent locally (optimistic); will be accurate after next reload.
    // For campaign rows the status update is local-only; for reminders the backend worker owns status.
    if (!composer) return
    queryClient.setQueryData(
      messagesKey,
      (old: { rows: MessageRow[]; templates: ReminderTemplate[] } | undefined) =>
        old
          ? {
              ...old,
              rows: old.rows.map((r) =>
                r.patientName === composer.recipientLabel && r.status === 'pending'
                  ? { ...r, status: 'sent' }
                  : r
              ),
            }
          : old
    )
  }

  async function handleDelete(row: MessageRow) {
    const res = await api.delete(`/api/scheduled-reminders/${row.id}`)
    if (res.success) {
      queryClient.setQueryData(
        messagesKey,
        (old: { rows: MessageRow[]; templates: ReminderTemplate[] } | undefined) =>
          old ? { ...old, rows: old.rows.filter((r) => r.id !== row.id) } : old
      )
      toast.success('Reminder deleted')
    } else {
      toast.error('Failed to delete reminder')
    }
  }

  function handleDismiss(row: MessageRow) {
    queryClient.setQueryData(
      messagesKey,
      (old: { rows: MessageRow[]; templates: ReminderTemplate[] } | undefined) =>
        old
          ? {
              ...old,
              rows: old.rows.map((r) => (r.id === row.id ? { ...r, status: 'dismissed' } : r)),
            }
          : old
    )
    toast.message(`Dismissed ${row.patientName}`)
  }

  const columns = useMemo(
    () => buildColumns(handleSend, handleDelete, handleDismiss),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleSend, handleDismiss, handleDelete]
  )

  if (!permsLoading && !hasPermission('messaging', 'read'))
    return <Navigate to="/appointments" replace />

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/appointments">Scheduling</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Reminders &amp; Campaigns</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reminders &amp; Activities</h1>
          <p className="mt-1 text-muted-foreground">
            Today's outreach queue — recare due, patient reminders, birthdays, unconfirmed
            appointments, overdue payments — plus the messaging schedules powering automated SMS.
          </p>
        </div>
        <Button onClick={() => setSheetOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Schedule Reminder
        </Button>
      </div>

      <Tabs defaultValue="activities">
        <TabsList>
          <TabsTrigger value="activities">Activities</TabsTrigger>
          <TabsTrigger value="messages">Scheduled messages</TabsTrigger>
        </TabsList>

        <TabsContent value="activities" className="mt-4">
          <ActionItemsCard
            isAdminView
            overduePayments={overduePayments}
            birthdaysAndFollowups={alerts}
            data={actionItems}
            loading={activitiesLoading}
            onReload={() => {
              activitiesQuery.refetch()
            }}
          />
        </TabsContent>

        <TabsContent value="messages" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : (
            <DataTable columns={columns} data={rows} />
          )}
        </TabsContent>
      </Tabs>

      <ScheduleSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        templates={templates}
        onCreated={() => messagesQuery.refetch()}
      />

      <SmsComposerSheet
        open={composer !== null}
        onOpenChange={(v) => {
          if (!v) setComposer(null)
        }}
        recipientLabel={composer?.recipientLabel ?? ''}
        defaultMessage={composer?.message ?? ''}
        onSend={handleComposerSend}
      />
    </div>
  )
}
