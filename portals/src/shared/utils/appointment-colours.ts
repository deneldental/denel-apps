/**
 * Calendar colour system (Phase B M3.6).
 *
 * Appointment events on the scheduling calendar are coloured along two axes:
 *
 *   1. By appointment type (consultation, follow-up, procedure, …) — the hue
 *      comes from `appointmentTypes.colour` in settings so admins can pick a
 *      palette that suits their clinic.
 *   2. By status overlay — statuses that carry independent operational
 *      meaning (blocked, no-show, completed, checked-in, rescheduled,
 *      cancelled) override the type hue so the calendar tells the viewer at
 *      a glance what state each slot is in.
 *
 * Colours are returned as inline-style-ready strings (hex or rgba) rather
 * than Tailwind classes because the type colour is data-driven and can't be
 * expressed as a static class name. Callers apply the result via
 * `style={{ backgroundColor, color, borderColor }}` and read `strikethrough`
 * / `label` to drive class-based decoration.
 *
 * No-show uses an rgba() value with a pre-baked alpha so the red survives
 * any outer `opacity-50` dim the cell might carry from the past/dimming
 * treatment (a class like `bg-red-500/50` would compound with the parent
 * opacity and wash out).
 */

export interface AppointmentColour {
  /** Inline background colour (hex or rgba). */
  background: string
  /** Inline text colour (hex). */
  text: string
  /** Inline border colour (hex). Optional. */
  border?: string
  /**
   * Replacement label for the event card body — used by block-time events
   * to render "Doctor Blocked" instead of the original "Unavailable".
   */
  label?: string
  /** When true, the event title should render with line-through. */
  strikethrough?: boolean
}

const DEFAULT_TYPE_COLOUR = '#94A3B8' // slate-400 — matches the schema default

// Status overlays. Chosen to pair dark-enough text with tinted backgrounds
// while keeping the colour vocabulary distinct from the type palette.
const STATUS_OVERLAYS: Record<string, AppointmentColour> = {
  // Block-time events — solid red, used for doctor_unavailability rows.
  blocked: {
    background: 'rgba(239, 68, 68, 0.15)',
    text: '#991B1B',
    border: '#EF4444',
    label: 'Doctor Blocked',
  },
  // No-show — survives any opacity-50 parent fade because we pre-bake alpha.
  no_show: {
    background: 'rgba(239, 68, 68, 0.85)',
    text: '#FFFFFF',
    border: '#B91C1C',
  },
  completed: {
    background: '#DCFCE7', // emerald-100
    text: '#166534', // emerald-800
    border: '#22C55E', // emerald-500
  },
  checked_in: {
    background: '#DBEAFE', // blue-100
    text: '#1E40AF', // blue-800
    border: '#3B82F6', // blue-500
  },
  rescheduled: {
    background: '#FEF3C7', // amber-100
    text: '#92400E', // amber-800
    border: '#F59E0B', // amber-500
  },
  cancelled: {
    background: '#F1F5F9', // slate-100
    text: '#64748B', // slate-500
    border: '#CBD5E1', // slate-300
    strikethrough: true,
  },
}

/**
 * Expand a hex into a tinted background. The raw hue stays as the border +
 * accent, the background is the same hue at ~18% alpha so events don't feel
 * overbearing in dense calendar views.
 */
function tintedBackground(hex: string): string {
  const normalized = hex.trim().replace('#', '')
  if (normalized.length !== 6) return 'rgba(148, 163, 184, 0.18)'
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return 'rgba(148, 163, 184, 0.18)'
  }
  return `rgba(${r}, ${g}, ${b}, 0.18)`
}

/**
 * Main entry point for calendar renderers.
 *
 * @param typeName  The appointment's `type` field (matches
 *                  `appointmentTypes.name`). `null`/`undefined` falls back
 *                  to the slate default.
 * @param status    The appointment's `status`, or `'blocked'` for
 *                  doctor-unavailability events.
 * @param typesLookup A map keyed by appointment-type name → row (we only
 *                  read `colour`), so the caller controls whether to fetch
 *                  the lookup once for the page or not.
 */
export function getAppointmentColour(
  typeName: string | null | undefined,
  status: string,
  typesLookup: Map<string, { colour?: string }>
): AppointmentColour {
  // Status overlays take priority when present. Scheduled/confirmed/in_chair
  // fall through to the type hue so the "live" appointment shows its type.
  const overlay = STATUS_OVERLAYS[status]
  if (overlay) return overlay

  const key = typeof typeName === 'string' ? typeName : ''
  const entry = key ? typesLookup.get(key) : undefined
  const rawColour = entry?.colour ?? DEFAULT_TYPE_COLOUR
  const safeColour = /^#[0-9A-Fa-f]{6}$/.test(rawColour) ? rawColour : DEFAULT_TYPE_COLOUR

  // On an 18%-alpha tint over white, dark text is always the readable pick.
  return {
    background: tintedBackground(safeColour),
    text: '#0F172A', // slate-900
    border: safeColour,
  }
}
