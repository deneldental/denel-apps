import { format } from 'date-fns'
import { Bell, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { PatientPicker, type PickerPatient } from '@/shared/components/patient-picker'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
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
  SheetTrigger,
} from '@/shared/components/ui/sheet'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

// ─── Types ────────────────────────────────────────────────────────────────────

type Template = {
  id: string
  name: string
  messageTemplate: string
}

type Reminder = {
  id: string
  name: string
  status: string
  requiresConfirmation: boolean
  confirmedAt: string | null
  scheduledAt: string | null
  createdAt: string
  patient: { id: string; name: string; patientId: string | null } | null
  template: { id: string; name: string } | null
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'secondary',
  sent: 'default',
  failed: 'destructive',
  cancelled: 'outline',
}

/** §13.2 — a queued marketing send still awaiting a staff member's confirmation. */
function isAwaitingConfirmation(r: Reminder): boolean {
  return r.requiresConfirmation && !r.confirmedAt && r.status === 'pending'
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScheduledRemindersTab() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [selectedPatient, setSelectedPatient] = useState<PickerPatient | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Reminder | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [remRes, tplRes] = await Promise.all([
      api.get<Reminder[]>('/api/scheduled-reminders'),
      api.get<Template[]>('/api/reminder-templates'),
    ])
    if (remRes.success && remRes.data) setReminders(remRes.data)
    if (tplRes.success && tplRes.data) setTemplates(tplRes.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setSelectedPatient(null)
    setSelectedTemplateId('')
    setScheduledAt('')
    setSheetOpen(true)
  }

  function closeSheet() {
    setSheetOpen(false)
  }

  async function save() {
    if (!selectedPatient) {
      toast.error('Select a patient')
      return
    }
    if (!selectedTemplateId) {
      toast.error('Select a message template')
      return
    }
    if (!scheduledAt) {
      toast.error('Set a scheduled date & time')
      return
    }

    const template = templates.find((t) => t.id === selectedTemplateId)
    const name = `${selectedPatient.name} — ${template?.name ?? 'Reminder'}`

    setSaving(true)
    const res = await api.post('/api/scheduled-reminders', {
      name,
      type: 'patient_specific',
      triggerType: 'on_date',
      scheduledAt,
      messageTemplate: template?.messageTemplate ?? '',
      isActive: true,
      status: 'pending',
      patientId: selectedPatient.id,
      templateId: selectedTemplateId,
    })
    setSaving(false)

    if (res.success) {
      toast.success('Reminder scheduled')
      closeSheet()
      load()
    } else {
      toast.error('Failed to schedule reminder')
    }
  }

  async function confirmReminder(r: Reminder) {
    setConfirmingId(r.id)
    const res = await api.post(`/api/scheduled-reminders/${r.id}/confirm`, {})
    setConfirmingId(null)
    if (res.success) {
      toast.success('Reminder confirmed — it will send at its scheduled time')
      setReminders((prev) =>
        prev.map((x) => (x.id === r.id ? { ...x, confirmedAt: new Date().toISOString() } : x))
      )
    } else {
      toast.error('Failed to confirm reminder')
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const res = await api.delete(`/api/scheduled-reminders/${deleteTarget.id}`)
    if (res.success) {
      toast.success('Reminder deleted')
      setReminders((prev) => prev.filter((x) => x.id !== deleteTarget.id))
      setDeleteTarget(null)
    } else {
      toast.error('Failed to delete reminder')
      throw new Error('delete failed')
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {reminders.length} reminder{reminders.length !== 1 ? 's' : ''} scheduled
          {(() => {
            const awaiting = reminders.filter(isAwaitingConfirmation).length
            return awaiting > 0 ? ` · ${awaiting} awaiting confirmation` : ''
          })()}
        </p>

        <Sheet
          open={sheetOpen}
          onOpenChange={(v) => {
            if (!v) closeSheet()
            else setSheetOpen(true)
          }}
        >
          <SheetTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Schedule Reminder
            </Button>
          </SheetTrigger>

          <SheetContent className="!w-full !max-w-[480px] overflow-y-auto">
            <SheetHeader className="mb-6">
              <SheetTitle>Schedule a Reminder</SheetTitle>
            </SheetHeader>

            <div className="space-y-5 pb-6">
              {/* Patient — shared PatientPicker (same UX as the New
                  Appointment sheet). */}
              <div className="space-y-1.5">
                <Label htmlFor="reminder-patient">Patient</Label>
                <PatientPicker
                  id="reminder-patient"
                  value={selectedPatient?.id ?? ''}
                  onChange={(_id, patient) => setSelectedPatient(patient)}
                  popoverWidthClass="w-[420px]"
                />
              </div>

              {/* Template */}
              <div className="space-y-1.5">
                <Label>Message Template</Label>
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
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
                {selectedTemplateId &&
                  (() => {
                    const tpl = templates.find((t) => t.id === selectedTemplateId)
                    if (!tpl) return null
                    // Render-time variable substitution. Mirrors the worker's
                    // expected behavior so the admin sees the actual recipient
                    // text. Add a placeholder for any var we don't know yet.
                    const renderedBody = tpl.messageTemplate
                      .replace(/\{\{?\s*name\s*\}?\}/gi, selectedPatient?.name ?? '[patient name]')
                      .replace(
                        /\{\{?\s*patient_name\s*\}?\}/gi,
                        selectedPatient?.name ?? '[patient name]'
                      )
                    const charCount = renderedBody.length
                    // SMS segments: 160 chars for GSM-7 (most reminders); 70 for UCS-2.
                    // Hubtel bills per segment; approximate at 160-char boundary.
                    const segments = Math.max(1, Math.ceil(charCount / 160))
                    return (
                      <div className="space-y-1.5">
                        <div className="rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 px-3 py-2.5 text-xs leading-relaxed text-blue-900 dark:text-blue-100 whitespace-pre-wrap">
                          {renderedBody}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Preview · {charCount} chars · {segments} SMS segment
                          {segments > 1 ? 's' : ''}
                          {!selectedPatient && (
                            <span className="ml-1 text-amber-700">
                              (select a patient to fill placeholders)
                            </span>
                          )}
                        </p>
                      </div>
                    )
                  })()}
              </div>

              {/* Date & time */}
              <div className="space-y-1.5">
                <Label htmlFor="sched-at">Send At</Label>
                <Input
                  id="sched-at"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
            </div>

            <SheetFooter>
              <Button onClick={save} disabled={saving} className="w-full">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Schedule Reminder
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* Empty state */}
      {reminders.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Bell className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-medium text-muted-foreground">No reminders scheduled</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Pick a patient, choose a template, and set a send time.
            </p>
          </div>
        </div>
      )}

      {reminders.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Scheduled Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[52px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reminders.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.patient ? (
                      <div>
                        <p className="text-sm font-medium">{r.patient.name}</p>
                        {r.patient.patientId && (
                          <p className="text-xs text-muted-foreground">{r.patient.patientId}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.template?.name ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.scheduledAt ? format(new Date(r.scheduledAt), 'MMM d, yyyy · h:mm a') : '—'}
                  </TableCell>
                  <TableCell>
                    {isAwaitingConfirmation(r) ? (
                      <Badge variant="secondary" className="text-xs">
                        Awaiting confirmation
                      </Badge>
                    ) : (
                      <Badge
                        variant={STATUS_VARIANT[r.status] ?? 'outline'}
                        className="text-xs capitalize"
                      >
                        {r.status}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {isAwaitingConfirmation(r) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-green-600 hover:text-green-700"
                          onClick={() => confirmReminder(r)}
                          disabled={confirmingId === r.id}
                          aria-label="Confirm and send"
                          title="Confirm & send"
                        >
                          {confirmingId === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(r)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete reminder?"
        description="The scheduled reminder will be removed and no SMS will be sent."
        itemName={
          deleteTarget?.patient?.name
            ? `Reminder for ${deleteTarget.patient.name}`
            : deleteTarget?.name
        }
      />
    </div>
  )
}
