import type { PatientTag } from '@/lib/actions/patient-tags'
import { cn } from '@/lib/utils'

// admin-v1 §2.7 — shared tag-pill rendering for the patient table, detail page,
// and form pickers. Two-variant styling: base uses light bg + dark text for
// read-only pills; selected flips to dark bg + light text for strong contrast
// in interactive pickers.
export const TAG_COLOR_CLASSES: Record<string, { base: string; selected: string }> = {
  slate: { base: 'bg-slate-100 text-foreground', selected: 'bg-slate-700 text-slate-50' },
  violet: { base: 'bg-violet-100 text-violet-700', selected: 'bg-violet-700 text-violet-50' },
  sky: { base: 'bg-sky-100 text-sky-700', selected: 'bg-sky-700 text-sky-50' },
  amber: { base: 'bg-amber-100 text-amber-700', selected: 'bg-amber-700 text-amber-50' },
  rose: { base: 'bg-rose-100 text-rose-700', selected: 'bg-rose-700 text-rose-50' },
  emerald: { base: 'bg-emerald-100 text-emerald-700', selected: 'bg-emerald-700 text-emerald-50' },
  cyan: { base: 'bg-cyan-100 text-cyan-700', selected: 'bg-cyan-700 text-cyan-50' },
  orange: { base: 'bg-orange-100 text-orange-700', selected: 'bg-orange-700 text-orange-50' },
  green: { base: 'bg-green-100 text-green-700', selected: 'bg-green-700 text-green-50' },
  indigo: { base: 'bg-indigo-100 text-indigo-700', selected: 'bg-indigo-700 text-indigo-50' },
  pink: { base: 'bg-pink-100 text-pink-700', selected: 'bg-pink-700 text-pink-50' },
  teal: { base: 'bg-teal-100 text-teal-700', selected: 'bg-teal-700 text-teal-50' },
}

/** Returns the base class string for a color, falling back to slate. */
export const tagClass = (color: string) =>
  (TAG_COLOR_CLASSES[color] ?? TAG_COLOR_CLASSES.slate).base

/** Returns base or selected variant for a color. */
export const tagVariantClass = (color: string, selected: boolean) => {
  const entry = TAG_COLOR_CLASSES[color] ?? TAG_COLOR_CLASSES.slate
  return selected ? entry.selected : entry.base
}

/** Read-only coloured pills for a patient's tags (table cells, detail header). */
export function TagPills({
  tags,
  className,
}: {
  tags?: Array<Pick<PatientTag, 'id' | 'name' | 'color'>> | null
  className?: string
}) {
  if (!tags || tags.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {tags.map((t) => (
        <span
          key={t.id}
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            tagClass(t.color)
          )}
        >
          {t.name}
        </span>
      ))}
    </div>
  )
}
