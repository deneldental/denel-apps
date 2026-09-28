import { Loader2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  type AudienceFilters,
  type AudienceRecipient,
  type AudienceSegment,
  resolveAudience,
} from '@/lib/actions/crm'
import { getServices } from '@/lib/actions/services'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Label } from '@/shared/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { usePatientTagCatalog } from '@/shared/hooks/use-patient-tag-catalog'

// Static colour classes (Tailwind purges dynamically-built names).
const TAG_COLOR: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
}
const tagClass = (c: string) => TAG_COLOR[c] ?? TAG_COLOR.slate

const SEGMENTS: { value: AudienceSegment; label: string; hint: string }[] = [
  { value: 'all', label: 'All patients', hint: 'Everyone (no segment filter)' },
  { value: 'follow_up', label: 'Follow-ups', hint: 'Visited 48–72h ago' },
  { value: 'recare', label: 'Recare', hint: 'Recare due within 30 days' },
  { value: 'birthday', label: 'Birthdays', hint: 'Birthday in the next 7 days' },
]

const NONE_TREATMENT = '__none__'

interface TreatmentTypeOption {
  id: string
  name: string
  displayName?: string | null
}

export interface AudienceBuilderPanelProps {
  /** Notifies the parent whenever the resolved recipient list changes. */
  onResolved: (recipients: AudienceRecipient[]) => void
}

/**
 * §13.4 — audience builder. Pick a fixed segment AND/OR filter by treatment
 * type + patient tags; recipients (opt-out always excluded server-side) are
 * resolved live via POST /api/crm/audience and surfaced through `onResolved`
 * so the host composer can feed them into the existing send path.
 */
export function AudienceBuilderPanel({ onResolved }: AudienceBuilderPanelProps) {
  const [segment, setSegment] = useState<AudienceSegment>('all')
  const [treatmentTypeId, setTreatmentTypeId] = useState<string>(NONE_TREATMENT)
  const [tagIds, setTagIds] = useState<string[]>([])

  const [count, setCount] = useState<number | null>(null)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load filter options once.
  const servicesQuery = useApiQuery(queryKeys.services.list(), () => getServices())
  const treatmentTypes = useMemo<TreatmentTypeOption[]>(() => {
    // Map services to treatment types so the backend logic still works. We
    // only show services that actually have a mapped treatmentType, deduped
    // since multiple services can map to the same treatment type.
    const options = (servicesQuery.data ?? [])
      .filter((s: any) => s.treatmentTypeId)
      .map((s: any) => ({ id: s.treatmentTypeId, name: s.name, displayName: s.name }))
    return Array.from(new Map(options.map((item) => [item.id, item])).values())
  }, [servicesQuery.data])
  const { catalog: tags } = usePatientTagCatalog({ activeOnly: true })

  const filters = useMemo<AudienceFilters>(
    () => ({
      segment,
      treatmentTypeId: treatmentTypeId === NONE_TREATMENT ? null : treatmentTypeId,
      tagIds,
    }),
    [segment, treatmentTypeId, tagIds]
  )

  // Live recipient resolution — debounced so rapid filter edits coalesce.
  useEffect(() => {
    let cancelled = false
    setResolving(true)
    setError(null)
    const handle = setTimeout(async () => {
      const res = await resolveAudience(filters)
      if (cancelled) return
      setResolving(false)
      if (res.success && res.data) {
        setCount(res.data.count)
        onResolved(res.data.recipients)
      } else {
        setError(res.error ?? 'Failed to resolve audience')
        setCount(null)
        onResolved([])
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [filters, onResolved])

  const toggleTag = (id: string) => {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Audience</span>
      </div>

      {/* Fixed segment */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">Segment</Label>
        <RadioGroup
          value={segment}
          onValueChange={(v) => setSegment(v as AudienceSegment)}
          className="grid grid-cols-2 gap-2"
        >
          {SEGMENTS.map((s) => (
            <label
              key={s.value}
              htmlFor={`seg-${s.value}`}
              className="flex cursor-pointer items-start gap-2 rounded-md border p-2 hover:bg-accent"
            >
              <RadioGroupItem id={`seg-${s.value}`} value={s.value} className="mt-0.5" />
              <span className="flex flex-col">
                <span className="text-sm font-medium leading-none">{s.label}</span>
                <span className="mt-1 text-[11px] text-muted-foreground">{s.hint}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Service */}
      <div className="space-y-2">
        <Label htmlFor="audience-treatment" className="text-xs font-medium text-muted-foreground">
          Service (optional)
        </Label>
        <Select value={treatmentTypeId} onValueChange={setTreatmentTypeId}>
          <SelectTrigger id="audience-treatment">
            <SelectValue placeholder="Any service" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_TREATMENT}>Any service</SelectItem>
            {treatmentTypes.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.displayName || t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Patient tags */}
      {tags.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Patient tags (optional)
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const active = tagIds.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  aria-pressed={active}
                  className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      'cursor-pointer border-transparent',
                      tagClass(tag.color),
                      !active && 'opacity-50 hover:opacity-100'
                    )}
                  >
                    {tag.name}
                  </Badge>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Live recipient-count preview */}
      <div className="flex items-center gap-2 border-t pt-3 text-sm">
        {resolving ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Resolving recipients…
          </span>
        ) : error ? (
          <span className="text-destructive">{error}</span>
        ) : (
          <span>
            <span className="font-semibold tabular-nums">{count ?? 0}</span>{' '}
            <span className="text-muted-foreground">
              {count === 1 ? 'recipient' : 'recipients'} match (opt-outs excluded)
            </span>
          </span>
        )}
      </div>
    </div>
  )
}
