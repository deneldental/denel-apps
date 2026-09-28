import { StatCard } from '@denel/ui/blocks'
import { formatDistanceToNow } from 'date-fns'
import {
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  ListChecks,
  Loader2,
  Megaphone,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  markNotificationRead,
  type NotifItem,
  type NotifKind,
  useStaffNotifications,
} from '@/lib/use-notifications'
import { cn } from '@/lib/utils'

const KIND_META: Record<
  NotifKind,
  { icon: typeof Bell; label: string; chip: string; sheetChip: string }
> = {
  memo: {
    icon: Megaphone,
    label: 'Memo',
    chip: 'bg-sky-100 text-sky-700',
    sheetChip: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  task: {
    icon: ListChecks,
    label: 'Task',
    chip: 'bg-violet-100 text-violet-700',
    sheetChip: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  request: {
    icon: Clock,
    label: 'Request',
    chip: 'bg-amber-100 text-amber-700',
    sheetChip: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  request_approved: {
    icon: CheckCircle2,
    label: 'Approved',
    chip: 'bg-emerald-100 text-emerald-700',
    sheetChip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  request_rejected: {
    icon: XCircle,
    label: 'Rejected',
    chip: 'bg-rose-100 text-rose-700',
    sheetChip: 'bg-rose-50 text-rose-700 border-rose-200',
  },
}

export default function NotificationsPage() {
  const { items, loading, count, markAllRead } = useStaffNotifications()
  const [selected, setSelected] = useState<NotifItem | null>(null)

  const totalCount = items.length

  function openNotif(n: NotifItem) {
    markNotificationRead(n.id)
    setSelected(n)
  }

  return (
    <div className="space-y-5 p-5 pb-20">
      <header className="flex items-start justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Notifications</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Memos, tasks &amp; request updates</p>
        </div>
        {count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs hover:bg-primary/5 text-primary font-bold"
            onClick={markAllRead}
          >
            Mark all read
          </Button>
        )}
      </header>

      {!loading && totalCount > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard tone="brand" icon={Bell} value={count} label="Unread" />
          <StatCard tone="sky" icon={ListChecks} value={totalCount} label="Total" />
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Bell className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground">You're all caught up</p>
          <p className="text-xs text-muted-foreground/70">
            No new memos, tasks or request updates.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((n) => {
            const meta = KIND_META[n.kind]
            const Icon = meta.icon

            const cardCls = n.read
              ? 'border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50'
              : 'border-brand/20 bg-brand/5 text-foreground hover:border-brand/30 hover:bg-brand/10'

            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openNotif(n)}
                className={cn(
                  'w-full text-left relative flex items-center gap-3 rounded-2xl border px-4 py-3.5 transition-all duration-150 active:scale-[0.99] cursor-pointer',
                  cardCls
                )}
              >
                {/* Unread dot */}
                {!n.read && (
                  <span className="absolute top-3.5 left-2.5 h-1.5 w-1.5 rounded-full bg-brand" />
                )}

                {/* Kind icon pill */}
                <div
                  className={cn(
                    'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-2xs',
                    meta.chip
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>

                {/* Title */}
                <p
                  className={cn(
                    'font-semibold text-sm leading-snug flex-1 min-w-0 truncate',
                    n.read ? 'text-muted-foreground' : 'text-foreground'
                  )}
                >
                  {n.title}
                </p>

                {/* Time + kind badge */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge
                    variant="outline"
                    className={cn(
                      'capitalize font-bold border-none text-[9px] px-1.5 py-0.5 rounded-md',
                      meta.chip
                    )}
                  >
                    {meta.label}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground/70">
                    {formatDistanceToNow(new Date(n.date), { addSuffix: true })}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Bottom-sheet detail view ─────────────────────────────────── */}
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent side="bottom" className="p-0 rounded-t-2xl max-h-[75dvh] overflow-y-auto">
          {selected && <NotifSheetBody notif={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ─── Bottom-sheet body ───────────────────────────────────────────────────────
function NotifSheetBody({ notif }: { notif: NotifItem }) {
  const meta = KIND_META[notif.kind]
  const Icon = meta.icon

  return (
    <div className="flex flex-col">
      {/* Drag handle */}
      <div className="flex justify-center pt-3 pb-1 shrink-0">
        <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
      </div>

      {/* Header */}
      <SheetHeader className="px-5 pt-3 pb-4 text-left shrink-0">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-xs',
              meta.chip
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={cn(
                  'capitalize font-bold border text-[9px] px-2 py-0.5 rounded-md',
                  meta.sheetChip
                )}
              >
                {meta.label}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(notif.date), { addSuffix: true })}
              </span>
            </div>
            <SheetTitle className="mt-1.5 text-base font-bold leading-snug">
              {notif.title}
            </SheetTitle>
          </div>
        </div>
        <SheetDescription className="sr-only">{notif.title} notification details</SheetDescription>
      </SheetHeader>

      <div className="h-px bg-border shrink-0" />

      {/* Body */}
      <div className="px-5 py-4 flex-1">
        <p className="text-sm leading-relaxed text-foreground">{notif.body}</p>
      </div>

      {/* CTA — navigate to the linked page */}
      <div className="px-5 pb-6 pt-3 border-t border-border shrink-0">
        <Link
          to={notif.to}
          onClick={() => markNotificationRead(notif.id)}
          className="flex items-center justify-center gap-2 w-full h-11 rounded-xl font-bold text-sm bg-primary hover:bg-primary/90 text-white transition-colors duration-150"
        >
          <ExternalLink size={15} />
          View Details
        </Link>
      </div>
    </div>
  )
}
