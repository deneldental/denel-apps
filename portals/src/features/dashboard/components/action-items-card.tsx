import { format, formatDistanceToNow } from 'date-fns'
import { Bell, BellRing, Cake, CheckCircle2, Loader2, Phone, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CompletedActivitiesList } from '@/features/dashboard/components/completed-activities-list'
import type {
  ActionItemsData,
  AlertsPayload,
  BirthdayItem,
  OverduePaymentPlan,
  RecareDueItem,
  Reminder,
} from '@/features/dashboard/types'
import { completeActivity } from '@/lib/actions/activities'
import { sendPaymentReminder } from '@/lib/actions/reminders'
import { api } from '@/lib/api-client'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Textarea } from '@/shared/components/ui/textarea'
import { formatCurrency } from '@/shared/utils/currency'
import type { AppointmentRow } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityType = 'recare' | 'reminder' | 'birthday' | 'unconfirmed' | 'overdue'

interface ActivityItem {
  key: string
  type: ActivityType
  patientName: string
  patientId: string | null
  contextLine: string
  sortDate: Date
  recall?: RecareDueItem
  reminder?: Reminder
  birthday?: BirthdayItem
  appt?: AppointmentRow
  overdue?: OverduePaymentPlan
}

const TYPE_META: Record<ActivityType, { label: string; badgeClass: string }> = {
  recare: {
    label: 'Recare',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  reminder: {
    label: 'Reminder',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  birthday: {
    label: 'Birthday',
    badgeClass: 'bg-pink-100 text-pink-800 border-pink-200',
  },
  unconfirmed: {
    label: 'Unconfirmed',
    badgeClass: 'bg-muted text-muted-foreground border-border',
  },
  overdue: {
    label: 'Overdue',
    badgeClass: 'bg-red-100 text-red-800 border-red-200',
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Local key — no other screen reads the payment-reminder cooldown status. */
const cooldownStatusKey = (phones: string[]) =>
  ['dashboard', 'reminder-cooldown', phones.join(',')] as const

function getOverdueAmount(p: OverduePaymentPlan): number {
  return typeof p.overdueAmount === 'number' ? p.overdueAmount : 0
}

function buildPaymentMessage(p: OverduePaymentPlan): string {
  const amount = formatCurrency(getOverdueAmount(p))
  return `Dear ${p.patient.name}, this is a gentle reminder about your outstanding payment of ${amount}. Please contact Denel Dental Clinic to arrange payment. Thank you!`
}

// ─── Filter pill ──────────────────────────────────────────────────────────────

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  isAdminView?: boolean
  overduePayments?: OverduePaymentPlan[]
  birthdaysAndFollowups?: AlertsPayload
  data: ActionItemsData
  loading: boolean
  onReload: () => void | Promise<void>
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActionItemsCard({
  isAdminView = false,
  overduePayments = [],
  birthdaysAndFollowups,
  data,
  loading,
  onReload,
}: Props) {
  const birthdays = birthdaysAndFollowups?.birthdays ?? []
  const { recalls, reminders, unconfirmedAppts } = data

  // ── Existing state ───────────────────────────────────────────────────────
  const [contactDialog, setContactDialog] = useState<{
    recall: RecareDueItem
    notes: string
    submitting: boolean
  } | null>(null)

  const [remindedIds, setRemindedIds] = useState<Set<string>>(new Set())
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null)

  // ── Cooldown (server-side, per phone) ─────────────────────────────────────
  // Maps recipient phone → ISO timestamp of last successful payment_reminder
  const [optimisticSent, setOptimisticSent] = useState<Record<string, string>>({})
  // §3.3 — Pending (live) vs Completed (activity_completions log) view.
  const [view, setView] = useState<'pending' | 'completed'>('pending')

  const phones = useMemo(
    () =>
      overduePayments
        .map((p) =>
          p.patient.isChild && p.patient.guardianPhone ? p.patient.guardianPhone : p.patient.phone
        )
        .filter((ph): ph is string => !!ph),
    [overduePayments]
  )

  const cooldownQuery = useApiQuery(
    cooldownStatusKey(phones),
    () =>
      api.get<{ lastSentMap: Record<string, string | null>; cooldownHours: number }>(
        `/api/reminders/payment/cooldown-status?phones=${phones.map(encodeURIComponent).join(',')}`
      ),
    { enabled: phones.length > 0 }
  )
  // The server map plus any just-sent reminders this session, applied
  // optimistically so the cooldown reflects the send immediately.
  const lastSentMap = { ...(cooldownQuery.data?.lastSentMap ?? {}), ...optimisticSent }
  const cooldownHours = cooldownQuery.data?.cooldownHours ?? 24

  function getPhone(p: OverduePaymentPlan): string {
    return p.patient.isChild && p.patient.guardianPhone
      ? p.patient.guardianPhone
      : (p.patient.phone ?? '')
  }

  function getCooldown(p: OverduePaymentPlan): { cooling: boolean; hoursAgo?: number } {
    const phone = getPhone(p)
    const ts = lastSentMap[phone]
    if (!ts) return { cooling: false }
    const ms = Date.now() - new Date(ts).getTime()
    if (ms >= cooldownHours * 60 * 60 * 1000) return { cooling: false }
    return { cooling: true, hoursAgo: ms / (1000 * 3600) }
  }

  // ── Confirm dialog for overdue reminder ──────────────────────────────────
  const [confirmReminder, setConfirmReminder] = useState<{
    plan: OverduePaymentPlan
    message: string
  } | null>(null)

  // ── Filter ───────────────────────────────────────────────────────────────
  const [filterType, setFilterType] = useState<'all' | ActivityType>('all')

  // §3.1 — paginate the pending list so the Reminders Activities tab (and the
  // dashboard) page through items instead of rendering one long scroll.
  const [page, setPage] = useState(0)

  // ── Derived data ─────────────────────────────────────────────────────────
  const displayedOverdue = overduePayments.filter((p) => !doneIds.has(p.id))

  const items = useMemo<ActivityItem[]>(() => {
    const result: ActivityItem[] = []

    recalls.forEach((r) =>
      result.push({
        key: `recare-${r.id}`,
        type: 'recare',
        patientName: r.patient?.name ?? 'Patient',
        patientId: r.patientId,
        contextLine: [
          r.recallReason,
          r.recallDueDate
            ? formatDistanceToNow(new Date(r.recallDueDate), { addSuffix: true })
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        sortDate: r.recallDueDate ? new Date(r.recallDueDate) : new Date(),
        recall: r,
      })
    )

    reminders.forEach((rm) => {
      // Polymorphic display: specialist-targeted reminders show the doctor's
      // name + "Specialist" badge in the context line; patient-targeted ones
      // keep their existing format.
      const isSpecialist = rm.targetType === 'specialist'
      const targetName = isSpecialist
        ? (rm.targetSpecialist?.name ?? 'Specialist')
        : (rm.patient?.name ?? rm.title)
      result.push({
        key: `reminder-${rm.id}`,
        type: 'reminder',
        patientName: targetName,
        patientId: isSpecialist ? null : rm.patientId,
        contextLine: [
          rm.title,
          isSpecialist ? '· Specialist' : null,
          rm.reminderDate ? format(new Date(rm.reminderDate), 'MMM d') : null,
        ]
          .filter(Boolean)
          .join(' · '),
        sortDate: new Date(rm.reminderDate),
        reminder: rm,
      })
    })

    birthdays.forEach((b) =>
      result.push({
        key: `birthday-${b.id}`,
        type: 'birthday',
        patientName: b.name,
        patientId: b.id,
        contextLine: b.date
          ? [
              format(new Date(b.date), 'EEE, MMM d'),
              b.isToday ? 'Today' : b.isTomorrow ? 'Tomorrow' : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : '',
        sortDate: new Date(b.date),
        birthday: b,
      })
    )

    unconfirmedAppts.forEach((a) =>
      result.push({
        key: `unconfirmed-${a.id}`,
        type: 'unconfirmed',
        patientName: a.patient?.name ?? 'Patient',
        patientId: a.patient?.id ?? null,
        contextLine: a.date ? format(new Date(a.date), 'EEE, MMM d h:mm a') : String(a.date),
        sortDate: new Date(a.date),
        appt: a,
      })
    )

    displayedOverdue.forEach((p) =>
      result.push({
        key: `overdue-${p.id}`,
        type: 'overdue',
        patientName: p.patient.name,
        patientId: p.patient.id,
        contextLine: `${formatCurrency(getOverdueAmount(p))} expected`,
        sortDate: new Date(p.startDate),
        overdue: p,
      })
    )

    return result.sort((a, b) => a.sortDate.getTime() - b.sortDate.getTime())
  }, [recalls, reminders, birthdays, unconfirmedAppts, displayedOverdue])

  const typeCounts = useMemo(() => {
    const c: Partial<Record<ActivityType, number>> = {}
    for (const it of items) c[it.type] = (c[it.type] ?? 0) + 1
    return c
  }, [items])

  const visibleItems = filterType === 'all' ? items : items.filter((i) => i.type === filterType)

  const totalCount = items.length

  // §3.1 — page the filtered list. Clamp the page if the underlying list shrank
  // (e.g. an item was completed, or the filter changed to a smaller set) so we
  // never render past the last page.
  const PAGE_SIZE = 8
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pagedItems = visibleItems.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  // ── Action handlers ──────────────────────────────────────────────────────

  async function submitContactDialog() {
    if (!contactDialog) return
    setContactDialog({ ...contactDialog, submitting: true })
    // `/api/recalls` was never mounted — recare plans live at `/api/recare`, and
    // that handler completes the plan (stamping completedAt + rolling a recurring
    // plan's next alert date) off `status`, not the `markContacted` flag this
    // used to send, which zod stripped.
    const res = await api.patch(`/api/recare/${contactDialog.recall.id}`, {
      status: 'completed',
      notes: contactDialog.notes.trim() || null,
    })
    if (res.success) {
      // §3.3 — log to the shared activity_completions so the Completed tab is consistent.
      void completeActivity({ activityType: 'recare', refId: contactDialog.recall.id })
      toast.success('Marked as contacted')
      setContactDialog(null)
      await onReload()
    } else {
      toast.error((res.error as string) || 'Failed to mark as contacted')
      setContactDialog({ ...contactDialog, submitting: false })
    }
  }

  async function completeReminder(id: string) {
    const res = await api.patch(`/api/patient-reminders/${id}`, { status: 'completed' })
    if (res.success) {
      // §3.3 — log to the shared activity_completions so the Completed tab is consistent.
      void completeActivity({ activityType: 'patient_reminder', refId: id })
      toast.success('Reminder completed')
      await onReload()
    }
  }

  async function sendReminderSms(apptId: string) {
    const res = await api.post<{ smsError?: string }>(
      `/api/appointment-workflow/${apptId}/send-confirmation`,
      {}
    )
    if (res.success) {
      toast.success('Confirmation SMS sent')
      await onReload()
    } else {
      const reason =
        res.smsError ?? (res.error as string | undefined) ?? 'Failed to send confirmation SMS'
      toast.error(reason, { duration: 6000 })
    }
  }

  async function confirmAndSend() {
    if (!confirmReminder) return
    const p = confirmReminder.plan
    setConfirmReminder(null)
    setSendingReminderId(p.id)
    try {
      const result = await sendPaymentReminder({
        patientName: p.patient.name,
        patientPhone: p.patient.phone || '',
        guardianPhone: p.patient.guardianPhone,
        isChild: p.patient.isChild,
        amountDue: getOverdueAmount(p),
      })
      if (result.success) {
        toast.success('Reminder sent')
        setRemindedIds((prev) => new Set([...prev, p.id]))
        // Optimistically update the local cooldown map so the UI reflects the
        // send immediately without waiting for a refetch.
        const phone = getPhone(p)
        if (phone) setOptimisticSent((prev) => ({ ...prev, [phone]: new Date().toISOString() }))
      } else {
        toast.error((result.error as string) || 'Failed to send reminder')
      }
    } catch {
      toast.error('Failed to send reminder')
    } finally {
      setSendingReminderId(null)
    }
  }

  async function handleDone(planId: string) {
    // §3.3 — log the overdue item as completed to the shared activity_completions.
    void completeActivity({ activityType: 'overdue', refId: planId })
    setDoneIds((prev) => new Set([...prev, planId]))
    await onReload()
  }

  // ── Action renderer per type ─────────────────────────────────────────────

  function renderAction(item: ActivityItem) {
    switch (item.type) {
      case 'recare': {
        const r = item.recall!
        return (
          <div className="flex items-center gap-1 shrink-0">
            {r.patient?.phone && (
              <a
                href={`tel:${r.patient.phone}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
                aria-label="Call"
              >
                <Phone className="h-3.5 w-3.5" />
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setContactDialog({ recall: r, notes: '', submitting: false })}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Contacted
            </Button>
          </div>
        )
      }
      case 'reminder':
        return (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs shrink-0"
            onClick={() => completeReminder(item.reminder!.id)}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            Done
          </Button>
        )
      case 'birthday':
        return item.birthday?.phone ? (
          <a
            href={`tel:${item.birthday?.phone}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted text-muted-foreground shrink-0"
            aria-label="Call"
          >
            <Phone className="h-3.5 w-3.5" />
          </a>
        ) : null
      case 'unconfirmed':
        return (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs shrink-0"
            onClick={() => sendReminderSms(item.appt!.id)}
          >
            <Send className="h-3.5 w-3.5 mr-1" />
            Send SMS
          </Button>
        )
      case 'overdue': {
        const p = item.overdue!
        const isReminded = remindedIds.has(p.id)
        const isSending = sendingReminderId === p.id
        const { cooling, hoursAgo } = getCooldown(p)

        if (isReminded) {
          return (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs shrink-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
              onClick={() => handleDone(p.id)}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Done
            </Button>
          )
        }
        if (cooling) {
          return (
            <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0" disabled>
              <Bell className="h-3.5 w-3.5 mr-1" />
              {Math.round(hoursAgo!)}h ago
            </Button>
          )
        }
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            disabled={isSending}
            onClick={() => setConfirmReminder({ plan: p, message: buildPaymentMessage(p) })}
          >
            {isSending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Bell className="h-3.5 w-3.5 mr-1" />
            )}
            {isSending ? 'Sending…' : 'Remind'}
          </Button>
        )
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="h-4 w-4" />
              Activities
              {totalCount > 0 && (
                <Badge variant="destructive" className="text-[10px]">
                  {totalCount}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {isAdminView
                ? 'View all your pending activities'
                : 'Recare, reminders, and unconfirmed appointments'}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setView('pending')}
              className={`rounded-md px-2 py-1 text-xs ${view === 'pending' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >
              Pending
            </button>
            <button
              type="button"
              onClick={() => setView('completed')}
              className={`rounded-md px-2 py-1 text-xs ${view === 'completed' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >
              Completed
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {view === 'completed' ? (
          <CompletedActivitiesList />
        ) : loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : totalCount === 0 ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500/60 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">All caught up!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Type filter pills */}
            <div className="flex flex-wrap gap-1">
              <FilterPill
                active={filterType === 'all'}
                onClick={() => {
                  setFilterType('all')
                  setPage(0)
                }}
              >
                All ({totalCount})
              </FilterPill>
              {(['recare', 'reminder', 'birthday', 'unconfirmed', 'overdue'] as ActivityType[]).map(
                (t) =>
                  typeCounts[t] ? (
                    <FilterPill
                      key={t}
                      active={filterType === t}
                      onClick={() => {
                        setFilterType((f) => (f === t ? 'all' : t))
                        setPage(0)
                      }}
                    >
                      {TYPE_META[t].label} ({typeCounts[t]})
                    </FilterPill>
                  ) : null
              )}
            </div>

            {/* Unified list */}
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
              {visibleItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No items for this filter.
                </p>
              ) : (
                pagedItems.map((item) => {
                  const meta = TYPE_META[item.type]
                  return (
                    <div
                      key={item.key}
                      className="rounded-md border border-border px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="flex-1 min-w-0 flex items-start gap-2">
                        <span
                          className={`mt-0.5 shrink-0 inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-medium ${meta.badgeClass}`}
                        >
                          {meta.label === 'Birthday' ? (
                            <Cake className="h-2.5 w-2.5 mr-0.5" />
                          ) : null}
                          {meta.label}
                        </span>
                        <div className="min-w-0">
                          {item.patientId ? (
                            <Link
                              to={`/patients/${item.patientId}`}
                              className="text-sm font-medium truncate hover:underline block"
                            >
                              {item.patientName}
                            </Link>
                          ) : (
                            <p className="text-sm font-medium truncate">{item.patientName}</p>
                          )}
                          <p className="text-xs text-muted-foreground truncate">
                            {item.contextLine}
                          </p>
                        </div>
                      </div>
                      {renderAction(item)}
                    </div>
                  )
                })
              )}
            </div>

            {/* §3.1 — pagination controls (only when more than one page) */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {safePage + 1} of {pageCount}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* ── Recare "Contacted" dialog ──────────────────────────────────── */}
      <Dialog
        open={contactDialog !== null}
        onOpenChange={(o) => {
          if (!o) setContactDialog(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark recare as contacted</DialogTitle>
            <DialogDescription>
              {contactDialog?.recall.patient?.name
                ? `Recording outreach for ${contactDialog.recall.patient.name}.`
                : 'Recording outreach for this patient.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="recall-contact-notes">Notes (optional)</Label>
            <Textarea
              id="recall-contact-notes"
              autoFocus
              rows={4}
              placeholder="e.g. left voicemail, will follow up tomorrow"
              value={contactDialog?.notes ?? ''}
              onChange={(e) => setContactDialog((s) => (s ? { ...s, notes: e.target.value } : s))}
              disabled={contactDialog?.submitting}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setContactDialog(null)}
              disabled={contactDialog?.submitting}
            >
              Cancel
            </Button>
            <Button onClick={submitContactDialog} disabled={contactDialog?.submitting}>
              {contactDialog?.submitting ? 'Saving…' : 'Mark contacted'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Overdue payment reminder confirm dialog ───────────────────── */}
      <Dialog
        open={confirmReminder !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmReminder(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send payment reminder?</DialogTitle>
            <DialogDescription>
              The following SMS will be sent to{' '}
              <span className="font-medium text-foreground">
                {confirmReminder?.plan.patient.name}
              </span>
              . You won&apos;t be able to resend for 24 hours.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 px-3 py-2.5 text-sm leading-relaxed text-blue-900 dark:text-blue-100 whitespace-pre-wrap">
            {confirmReminder?.message}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReminder(null)}>
              Cancel
            </Button>
            <Button onClick={confirmAndSend}>
              <Send className="mr-2 h-4 w-4" />
              Send SMS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
