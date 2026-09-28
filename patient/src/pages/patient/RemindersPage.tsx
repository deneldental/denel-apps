import { formatDistanceToNow } from 'date-fns'
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'

interface ApiReminder {
  id: string
  patientId: string
  subject: string
  body: string
  channel: 'sms' | 'email' | 'whatsapp' | 'push'
  scheduledFor: string // ISO
  status: 'scheduled' | 'sent' | 'delivered' | 'failed'
}

type ReminderChannel = ApiReminder['channel']

const CHANNEL_ICON: Record<ReminderChannel, React.ComponentType<{ className?: string }>> = {
  sms: MessageSquare,
  email: Mail,
  whatsapp: Phone,
  push: Bell,
}

const CHANNEL_LABEL: Record<ReminderChannel, string> = {
  sms: 'SMS',
  email: 'Email',
  whatsapp: 'WhatsApp',
  push: 'Push',
}

const STATUS_VARIANT: Record<ApiReminder['status'], 'info' | 'success' | 'error' | 'secondary'> = {
  scheduled: 'info',
  sent: 'secondary',
  delivered: 'success',
  failed: 'error',
}

const PAST_STATUSES: ApiReminder['status'][] = ['sent', 'delivered', 'failed']

export default function PatientRemindersPage() {
  const [reminders, setReminders] = useState<ApiReminder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<ApiReminder[]>('/api/patient-portal/reminders')
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setReminders(res.data)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )

  const upcoming = reminders.filter((r) => !PAST_STATUSES.includes(r.status))
  const past = reminders.filter((r) => PAST_STATUSES.includes(r.status))

  return (
    <div className="p-5 pb-8 space-y-6">
      <div className="pt-4">
        <h1 className="text-2xl font-bold tracking-tight">Reminders</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Notifications the clinic has scheduled for you.
        </p>
      </div>

      {reminders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <BellOff className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground">No reminders right now.</p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Upcoming
              </h2>
              {upcoming.map((r) => (
                <ReminderRow key={r.id} reminder={r} />
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Past
              </h2>
              {past.map((r) => (
                <ReminderRow key={r.id} reminder={r} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function ReminderRow({ reminder }: { reminder: ApiReminder }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = CHANNEL_ICON[reminder.channel]
  const truncated = reminder.body.length > 90
  const preview = truncated && !expanded ? `${reminder.body.slice(0, 90).trim()}…` : reminder.body
  const relative = formatDistanceToNow(new Date(reminder.scheduledFor), { addSuffix: true })

  return (
    <button
      type="button"
      onClick={() => truncated && setExpanded((v) => !v)}
      className="w-full text-left rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/30"
      aria-expanded={truncated ? expanded : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-tight">{reminder.subject}</p>
            <Badge variant={STATUS_VARIANT[reminder.status]} className="capitalize shrink-0">
              {reminder.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{preview}</p>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-muted-foreground">
              {CHANNEL_LABEL[reminder.channel]} · {relative}
            </span>
            {truncated && (
              <span className="inline-flex items-center text-[11px] text-muted-foreground">
                {expanded ? (
                  <>
                    Less <ChevronUp className="ml-0.5 h-3 w-3" />
                  </>
                ) : (
                  <>
                    More <ChevronDown className="ml-0.5 h-3 w-3" />
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
