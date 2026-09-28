import { formatDistanceToNow } from 'date-fns'
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Loader2,
  Receipt,
  XCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  markNotificationRead,
  type NotifKind,
  usePatientNotifications,
} from '@/lib/use-notifications'

const KIND_STYLE: Record<NotifKind, { icon: typeof Bell; chip: string }> = {
  request: { icon: CalendarClock, chip: 'bg-amber-100 text-amber-700' },
  cancelled: { icon: XCircle, chip: 'bg-rose-100 text-rose-700' },
  payment: { icon: CreditCard, chip: 'bg-orange-100 text-orange-700' },
  payment_confirmed: { icon: CheckCircle2, chip: 'bg-emerald-100 text-emerald-700' },
  payment_rejected: { icon: XCircle, chip: 'bg-rose-100 text-rose-700' },
  reminder: { icon: Receipt, chip: 'bg-sky-100 text-sky-700' },
}

export default function NotificationsPage() {
  const { items, loading, count, markAllRead } = usePatientNotifications()

  return (
    <div className="space-y-4 p-5 pb-8">
      <header className="flex items-start justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Notifications</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Alerts, pending actions & reminders
          </p>
        </div>
        {count > 0 && (
          <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={markAllRead}>
            Mark all read
          </Button>
        )}
      </header>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Bell className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground">You're all caught up</p>
          <p className="text-xs text-muted-foreground/70">No alerts or pending actions.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const style = KIND_STYLE[n.kind]
            const Icon = style.icon
            return (
              <Link
                key={n.id}
                to={n.to}
                onClick={() => markNotificationRead(n.id)}
                className={`flex items-start gap-3 rounded-2xl border p-4 transition-colors ${
                  n.read
                    ? 'border-border bg-card hover:border-brand/40'
                    : 'border-brand/30 bg-brand/5'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.chip}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{n.title}</p>
                    {!n.read && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-brand"
                        role="img"
                        aria-label="New"
                        title="New"
                      />
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {formatDistanceToNow(new Date(n.date), { addSuffix: true })}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
