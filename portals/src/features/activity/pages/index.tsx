import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DoctorLens } from '@/features/activity/components/doctor-lens'
import { NotificationsPanel } from '@/features/activity/components/notifications-panel'
import { ReceptionLens } from '@/features/activity/components/reception-lens'
import { Button } from '@/shared/components/ui/button'
import { usePermissions } from '@/shared/hooks/use-permissions'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/**
 * Activity — the visit worklist (build plan P2). A lens over today's visits.
 * Doctors get the day-sheet queue; reception gets the billing lens; admins see
 * both via tabs. The "Requires estimate" routing surfaces here.
 *
 * A second top-level tab, Notifications, carries the things assigned TO the
 * signed-in user (tasks + staff memos) rather than the day's patient work.
 */
export default function ActivityPage() {
  const { isAdmin, hasPermission, isLoading } = usePermissions()
  const [date, setDate] = useState(todayIso())
  const [view, setView] = useState<'activities' | 'notifications'>('activities')

  const isClinicalUser =
    hasPermission('medical_records', 'read') && !hasPermission('appointments', 'create')
  const isFrontDesk = hasPermission('appointments', 'create')

  const showDoctor = isAdmin || isClinicalUser
  // Force reception lens off for clinical users so they only see the day sheet
  const showReception =
    isAdmin || (!isClinicalUser && (isFrontDesk || hasPermission('payments', 'create')))
  const lenses = useMemo(() => {
    const l: Array<'doctor' | 'reception'> = []
    if (showDoctor) l.push('doctor')
    if (showReception) l.push('reception')
    return l
  }, [showDoctor, showReception])

  // The lens is DERIVED from what's available, not seeded into state. Permissions
  // load asynchronously, so on the first render roleId is still null and every
  // `show*` flag is false — a `useState(showDoctor ? … : …)` initializer would
  // latch "reception" and never re-run, stranding doctors on the billing lens
  // with no tabs to switch back (only admins see both). `lensChoice` holds an
  // explicit pick and is ignored once it's no longer one of the options.
  const [lensChoice, setLensChoice] = useState<'doctor' | 'reception' | null>(null)
  const lens: 'doctor' | 'reception' =
    lensChoice && lenses.includes(lensChoice) ? lensChoice : (lenses[0] ?? 'doctor')
  const isToday = date === todayIso()

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
          <p className="text-sm text-muted-foreground">
            {view === 'notifications'
              ? 'Tasks and memos assigned to you.'
              : `The day's visits — ${lens === 'doctor' ? 'your clinical queue' : 'billing lens'}.`}
          </p>
        </div>
        {/* Date nav — only meaningful for the day-scoped worklist. */}
        {view === 'activities' && (
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" onClick={() => setDate((d) => shiftIso(d, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayIso())}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            />
            <Button variant="outline" size="icon" onClick={() => setDate((d) => shiftIso(d, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isToday && (
              <Button variant="ghost" size="sm" onClick={() => setDate(todayIso())}>
                Today
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Top-level tabs: the day's work vs. what's addressed to you. */}
      <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setView('activities')}
          className={`rounded-md px-3 py-1.5 font-medium ${view === 'activities' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
        >
          Activities
        </button>
        <button
          type="button"
          onClick={() => setView('notifications')}
          className={`rounded-md px-3 py-1.5 font-medium ${view === 'notifications' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
        >
          Notifications
        </button>
      </div>

      {view === 'notifications' ? (
        <NotificationsPanel />
      ) : (
        <>
          {/* Lens tabs (only when both are available, i.e. admin) */}
          {lenses.length > 1 && (
            <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setLensChoice('doctor')}
                className={`rounded-md px-3 py-1.5 font-medium ${lens === 'doctor' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
              >
                Doctor day-sheet
              </button>
              <button
                type="button"
                onClick={() => setLensChoice('reception')}
                className={`rounded-md px-3 py-1.5 font-medium ${lens === 'reception' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
              >
                Reception
              </button>
            </div>
          )}

          {/* Don't decide anything until permissions land — otherwise the empty
              "no lens" state flashes before the real lens resolves. */}
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : lenses.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              You don't have access to a worklist lens.
            </div>
          ) : lens === 'doctor' ? (
            <DoctorLens date={date} />
          ) : (
            <ReceptionLens date={date} />
          )}
        </>
      )}
    </div>
  )
}
