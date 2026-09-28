import { format } from 'date-fns'
import { ImageOff, Loader2, ScanLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ApiXray {
  id: string
  patientId: string
  type: string
  imageUrl: string
  thumbnailUrl: string
  takenAt: string // ISO
  toothNumbers: number[]
  notes: string | null
  source: string
}

type FilterKey = 'all' | '30d' | '6m' | 'older'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: '30d', label: 'Last 30 days' },
  { key: '6m', label: 'Last 6 months' },
  { key: 'older', label: 'Older' },
]

const DAY = 24 * 60 * 60 * 1000

function withinFilter(taken: string, filter: FilterKey): boolean {
  if (filter === 'all') return true
  const ageMs = Date.now() - new Date(taken).getTime()
  if (filter === '30d') return ageMs <= 30 * DAY
  if (filter === '6m') return ageMs <= 182 * DAY
  return ageMs > 182 * DAY
}

export default function PatientXraysListPage() {
  const [xrays, setXrays] = useState<ApiXray[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')

  useEffect(() => {
    api
      .get<ApiXray[]>('/api/patient-portal/xrays')
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setXrays(res.data)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )

  const filtered = xrays
    .filter((x) => withinFilter(x.takenAt, filter))
    .sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime())

  return (
    <div className="p-5 pb-8 space-y-5">
      <div className="pt-4">
        <h1 className="text-2xl font-bold tracking-tight">My X-rays</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Imaging captured during your visits.</p>
      </div>

      <div className="-mx-5 px-5 overflow-x-auto">
        <div className="flex gap-2 w-max">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                filter === f.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {xrays.length === 0 ? (
        <EmptyState message="No X-rays on file yet." />
      ) : filtered.length === 0 ? (
        <EmptyState message="No X-rays match this filter." />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((x) => (
            <Link
              key={x.id}
              to={`/patient/xrays/${x.id}`}
              className="block rounded-2xl border border-border bg-card p-3 no-underline transition-colors hover:border-primary/40"
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-14 w-14 rounded-xl">
                  <AvatarImage src={x.thumbnailUrl} alt={`${x.type} X-ray`} />
                  <AvatarFallback className="rounded-xl bg-muted text-muted-foreground">
                    <ScanLine className="h-5 w-5" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">
                    {format(new Date(x.takenAt), 'MMM d, yyyy')}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="capitalize">
                      {x.type}
                    </Badge>
                    {x.toothNumbers && x.toothNumbers.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        Tooth {x.toothNumbers.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <ImageOff className="h-10 w-10 text-muted-foreground/30" />
      <p className="text-muted-foreground">{message}</p>
    </div>
  )
}
