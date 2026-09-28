import { Badge } from '@denel/ui'
import { cn } from '@denel/utils'
import type { ReactNode } from 'react'

/**
 * Tag pills — the multicoloured half of the HR badge system.
 *
 * Every pill that names a *category* (role, department, specialty, scope,
 * document type, priority-as-label…) renders through here. Each distinct label
 * gets a stable colour derived from its text, so the same tag is always the
 * same colour across the app, and a list of tags reads as a spread of hues
 * rather than a wall of grey.
 *
 * The palette deliberately excludes green / amber / red — those belong to
 * `StatusBadge` (traffic-light state). This keeps the two systems legible:
 * colourful = category, traffic-light = state.
 */

// Full literal class strings (not template-built) so the Tailwind scanner keeps
// them. Each entry pairs a light and dark treatment, matching the soft
// bg-100 / text-700 → bg-900/30 / text-400 convention used elsewhere.
const TAG_PALETTE: string[] = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
]

/** Stable string hash (djb2). Same label → same bucket, every render. */
function hashLabel(label: string): number {
  let hash = 5381
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 33) ^ label.charCodeAt(i)
  }
  return hash >>> 0
}

/** The Tailwind colour classes a given tag label maps to. */
export function tagColorClass(label: string): string {
  const key = label.trim().toLowerCase()
  const idx = hashLabel(key) % TAG_PALETTE.length
  return TAG_PALETTE[idx] ?? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
}

interface TagBadgeProps {
  /** The tag text. Also seeds the colour when `label` isn't given separately. */
  children: ReactNode
  /** Override the colour seed (e.g. stable colour for a formatted label). */
  label?: string
  className?: string
}

/**
 * A multicoloured category pill.
 *
 *   <TagBadge>{role}</TagBadge>
 *   <TagBadge label={dept.name}>{dept.displayName}</TagBadge>
 */
export function TagBadge({ children, label, className }: TagBadgeProps) {
  const seed = label ?? (typeof children === 'string' ? children : String(children))
  return (
    <Badge variant="outline" className={cn('border-transparent', tagColorClass(seed), className)}>
      {children}
    </Badge>
  )
}
