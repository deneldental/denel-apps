import { StatCard } from '@denel/ui/blocks'
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Paperclip, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

export interface StaffRequest {
  id: string
  requestType: string
  subType?: string
  description?: string
  reason?: string
  status: string
  startDate?: string
  endDate?: string
  submittedAt: string
  reviewComments?: string
  attachments?: { name: string; url: string }[] | string[]
}

const statusConfig: Record<
  string,
  { icon: React.ElementType; variant: 'success' | 'error' | 'warning' }
> = {
  pending: { icon: Clock, variant: 'warning' },
  approved: { icon: CheckCircle2, variant: 'success' },
  rejected: { icon: XCircle, variant: 'error' },
}

const typeLabels: Record<string, string> = {
  leave: 'Leave Request',
  permit: 'Permit',
  emergency: 'Emergency Support',
  official_support: 'Official Support',
  suggestion: 'Suggestion',
}

/** Two-page nav — links between the Requests and Suggestions pages. */
export function RequestsNav() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex-1 py-2.5 text-center text-sm font-semibold border-b-2 transition-colors no-underline',
      isActive
        ? 'border-primary text-primary font-bold'
        : 'border-transparent text-muted-foreground hover:text-foreground'
    )
  return (
    <div className="flex border-b border-border">
      <NavLink to="/requests" end className={linkClass}>
        My Requests
      </NavLink>
      <NavLink to="/suggestions" className={linkClass}>
        Suggestions
      </NavLink>
    </div>
  )
}

/** The pending / approved / rejected summary row. Hidden when there's nothing. */
export function RequestStats({ requests }: { requests: StaffRequest[] }) {
  if (requests.length === 0) return null
  const pending = requests.filter((r) => r.status === 'pending').length
  const approved = requests.filter((r) => r.status === 'approved').length
  const rejected = requests.filter((r) => r.status === 'rejected').length
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard tone="amber" icon={Clock} value={pending} label="Pending" />
      <StatCard tone="emerald" icon={CheckCircle2} value={approved} label="Approved" />
      <StatCard tone="brand" icon={XCircle} value={rejected} label="Rejected" />
    </div>
  )
}

/** Paginated list of request/suggestion cards. Renders `empty` when there are none. */
export function RequestList({
  requests,
  empty,
  heading,
}: {
  requests: StaffRequest[]
  empty: React.ReactNode
  heading?: string
}) {
  const [page, setPage] = useState(1)

  const sorted = useMemo(
    () =>
      [...requests].sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      ),
    [requests]
  )

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const paged = sorted.slice(pageStart, pageStart + PAGE_SIZE)

  if (sorted.length === 0) return <>{empty}</>

  return (
    <div className="space-y-3">
      {heading && <h3 className="text-sm font-bold text-foreground">{heading}</h3>}
      {paged.map((req) => (
        <RequestCard key={req.id} req={req} />
      ))}

      {sorted.length > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-3">
          <span className="text-xs text-muted-foreground">
            {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="text-xs font-semibold px-2">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function RequestCard({ req }: { req: StaffRequest }) {
  const sc = statusConfig[req.status] || statusConfig.pending
  const StatusIcon = sc.icon

  const tone: 'emerald' | 'amber' | 'brand' =
    req.status === 'approved' ? 'emerald' : req.status === 'rejected' ? 'brand' : 'amber'

  const t = {
    emerald: {
      card: 'border-emerald-100 bg-emerald-50 text-emerald-950 hover:border-emerald-200',
      chip: 'bg-emerald-100 text-emerald-700',
      text: 'text-emerald-950',
      muted: 'text-emerald-800/80',
      comments: 'bg-emerald-100/50 border-emerald-200/50 text-emerald-950',
    },
    amber: {
      card: 'border-amber-100 bg-amber-50 text-amber-950 hover:border-amber-200',
      chip: 'bg-amber-100 text-amber-700',
      text: 'text-amber-950',
      muted: 'text-amber-800/80',
      comments: 'bg-amber-100/50 border-amber-200/50 text-amber-950',
    },
    brand: {
      card: 'border-brand/20 bg-brand/5 text-foreground hover:border-brand/30',
      chip: 'bg-brand/15 text-brand',
      text: 'text-foreground',
      muted: 'text-muted-foreground',
      comments: 'bg-brand/10 border-brand/20 text-foreground',
    },
  }[tone]

  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 rounded-2xl border p-4 transition-all duration-200 hover:shadow-xs active:scale-[0.99]',
        t.card
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-2xs font-bold',
              t.chip
            )}
          >
            <StatusIcon size={18} />
          </div>
          <div className="min-w-0">
            <div className={cn('font-bold text-sm leading-tight', t.text)}>
              {typeLabels[req.requestType] || req.requestType}
            </div>
            {req.subType && (
              <div
                className={cn('text-[11px] font-semibold uppercase tracking-wider mt-0.5', t.muted)}
              >
                {req.subType.replace(/_/g, ' ')}
              </div>
            )}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'capitalize font-bold border-none px-2.5 py-1 text-[10px] rounded-lg shadow-2xs shrink-0',
            t.chip
          )}
        >
          {req.status}
        </Badge>
      </div>

      {req.reason && (
        <p className={cn('text-xs leading-relaxed whitespace-pre-line', t.muted)}>{req.reason}</p>
      )}

      {req.attachments && req.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {req.attachments.map((att: any, idx: number) => {
            const name = typeof att === 'string' ? `Attachment ${idx + 1}` : att.name
            const url = typeof att === 'string' ? att : att.url
            return (
              <a
                key={idx}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors max-w-[200px]',
                  'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                )}
              >
                <Paperclip size={10} className="shrink-0" />
                <span className="truncate">{name}</span>
              </a>
            )
          })}
        </div>
      )}

      <div
        className={cn(
          'flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider',
          t.muted
        )}
      >
        <span>Submitted: {new Date(req.submittedAt).toLocaleDateString()}</span>
        {req.startDate && (
          <span>
            • Duration: {new Date(req.startDate).toLocaleDateString()}{' '}
            {req.endDate && `– ${new Date(req.endDate).toLocaleDateString()}`}
          </span>
        )}
      </div>

      {req.reviewComments && req.status !== 'pending' && (
        <div className={cn('px-3.5 py-2.5 rounded-xl border text-xs leading-relaxed', t.comments)}>
          <span className="font-bold">Admin Comments:</span> {req.reviewComments}
        </div>
      )}
    </div>
  )
}
