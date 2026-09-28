import type { ToothSurface } from '../types'

/**
 * Each shape below renders a single tooth in a 60×60 SVG viewBox using the
 * same 5-surface coloring convention as the legacy rectangular implementation:
 *
 *   ┌─────────────┐
 *   │      B      │   buccal / labial (outer)
 *   │M    O     D │   occlusal / incisal (top of crown) with M + D flanks
 *   │      L      │   lingual / palatal (inner)
 *   └─────────────┘
 *
 * The silhouettes vary by anatomical type:
 *   - Incisor:  narrow rectangle, flat incisal edge, no cusps
 *   - Canine:   narrow shield with a pointed incisal tip
 *   - Premolar: oval crown, 2 cusps shown in the occlusal centre
 *   - Molar:    squarish crown, 4 cusps in a 2×2 arrangement
 *
 * All shapes preserve surface click-target semantics (the whole tooth is still
 * one click target in the parent component — this file only dictates visuals).
 */

export interface ShapeProps {
  /** Resolved fill colour per surface (`'whole'` handled by caller). */
  colorFor: (s: Exclude<ToothSurface, 'whole'>) => string
  stroke?: string
  strokeWidth?: number
}

const DEFAULT_STROKE = '#9ca3af'
const DEFAULT_STROKE_WIDTH = 1
const CUSP_STROKE = '#6b7280'
const CUSP_STROKE_WIDTH = 0.75

// ─── Molar ────────────────────────────────────────────────────────────────────
// Wide rounded-square crown with 4 cusps (a 2×2 arrangement inside the
// occlusal area) and deep central fossa lines.
export function MolarShape({
  colorFor,
  stroke = DEFAULT_STROKE,
  strokeWidth = DEFAULT_STROKE_WIDTH,
}: ShapeProps) {
  return (
    <g>
      {/* Buccal strip (top) */}
      <path
        d="M 6 6 Q 8 4 12 4 L 48 4 Q 52 4 54 6 L 46 18 L 14 18 Z"
        fill={colorFor('B')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Mesial strip (left) */}
      <path
        d="M 6 6 L 14 18 L 14 42 L 6 54 Q 4 52 4 48 L 4 12 Q 4 8 6 6 Z"
        fill={colorFor('M')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Distal strip (right) */}
      <path
        d="M 54 6 L 46 18 L 46 42 L 54 54 Q 56 52 56 48 L 56 12 Q 56 8 54 6 Z"
        fill={colorFor('D')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Lingual strip (bottom) */}
      <path
        d="M 6 54 L 14 42 L 46 42 L 54 54 Q 52 56 48 56 L 12 56 Q 8 56 6 54 Z"
        fill={colorFor('L')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Occlusal (centre) */}
      <rect
        x="14"
        y="18"
        width="32"
        height="24"
        fill={colorFor('O')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* 4 cusps (decorative) */}
      <circle cx="22" cy="25" r="1.5" fill={CUSP_STROKE} opacity="0.35" />
      <circle cx="38" cy="25" r="1.5" fill={CUSP_STROKE} opacity="0.35" />
      <circle cx="22" cy="35" r="1.5" fill={CUSP_STROKE} opacity="0.35" />
      <circle cx="38" cy="35" r="1.5" fill={CUSP_STROKE} opacity="0.35" />
      {/* Central groove (+ pattern) */}
      <line
        x1="30"
        y1="20"
        x2="30"
        y2="40"
        stroke={CUSP_STROKE}
        strokeWidth={CUSP_STROKE_WIDTH}
        opacity="0.4"
      />
      <line
        x1="16"
        y1="30"
        x2="44"
        y2="30"
        stroke={CUSP_STROKE}
        strokeWidth={CUSP_STROKE_WIDTH}
        opacity="0.4"
      />
    </g>
  )
}

// ─── Premolar ─────────────────────────────────────────────────────────────────
// Oval-ish crown, narrower than a molar, with 2 cusps visible in the occlusal
// area separated by a single vertical groove.
export function PremolarShape({
  colorFor,
  stroke = DEFAULT_STROKE,
  strokeWidth = DEFAULT_STROKE_WIDTH,
}: ShapeProps) {
  return (
    <g>
      {/* Buccal strip */}
      <path
        d="M 14 6 Q 18 4 22 4 L 38 4 Q 42 4 46 6 L 40 18 L 20 18 Z"
        fill={colorFor('B')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Mesial strip */}
      <path
        d="M 14 6 L 20 18 L 20 42 L 14 54 Q 10 48 10 40 L 10 20 Q 10 12 14 6 Z"
        fill={colorFor('M')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Distal strip */}
      <path
        d="M 46 6 L 40 18 L 40 42 L 46 54 Q 50 48 50 40 L 50 20 Q 50 12 46 6 Z"
        fill={colorFor('D')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Lingual strip */}
      <path
        d="M 14 54 L 20 42 L 40 42 L 46 54 Q 42 56 38 56 L 22 56 Q 18 56 14 54 Z"
        fill={colorFor('L')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Occlusal */}
      <rect
        x="20"
        y="18"
        width="20"
        height="24"
        fill={colorFor('O')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* 2 cusps */}
      <circle cx="25" cy="30" r="1.75" fill={CUSP_STROKE} opacity="0.35" />
      <circle cx="35" cy="30" r="1.75" fill={CUSP_STROKE} opacity="0.35" />
      {/* Central groove */}
      <line
        x1="30"
        y1="20"
        x2="30"
        y2="40"
        stroke={CUSP_STROKE}
        strokeWidth={CUSP_STROKE_WIDTH}
        opacity="0.4"
      />
    </g>
  )
}

// ─── Canine ───────────────────────────────────────────────────────────────────
// Narrow shield silhouette with a pointed incisal tip. The "occlusal" (really
// incisal) region is rendered as a triangle at the top.
export function CanineShape({
  colorFor,
  stroke = DEFAULT_STROKE,
  strokeWidth = DEFAULT_STROKE_WIDTH,
}: ShapeProps) {
  return (
    <g>
      {/* Buccal strip — pointed tip */}
      <path
        d="M 30 4 L 44 14 L 38 20 L 22 20 L 16 14 Z"
        fill={colorFor('B')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Mesial strip (left) */}
      <path
        d="M 16 14 L 22 20 L 22 42 L 18 54 Q 14 48 14 40 L 14 22 Q 14 18 16 14 Z"
        fill={colorFor('M')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Distal strip (right) */}
      <path
        d="M 44 14 L 38 20 L 38 42 L 42 54 Q 46 48 46 40 L 46 22 Q 46 18 44 14 Z"
        fill={colorFor('D')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Lingual strip (bottom) */}
      <path
        d="M 18 54 L 22 42 L 38 42 L 42 54 Q 38 56 34 56 L 26 56 Q 22 56 18 54 Z"
        fill={colorFor('L')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Incisal (mapped to 'O' for data-model compatibility) — thin rhombus */}
      <rect
        x="22"
        y="20"
        width="16"
        height="22"
        fill={colorFor('O')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Pointed cusp indicator */}
      <path d="M 30 22 L 34 30 L 30 28 L 26 30 Z" fill={CUSP_STROKE} opacity="0.35" />
    </g>
  )
}

// ─── Incisor ──────────────────────────────────────────────────────────────────
// Narrow rectangular crown with a flat incisal edge. No cusps.
export function IncisorShape({
  colorFor,
  stroke = DEFAULT_STROKE,
  strokeWidth = DEFAULT_STROKE_WIDTH,
}: ShapeProps) {
  return (
    <g>
      {/* Buccal strip (top) */}
      <path
        d="M 18 4 L 42 4 L 38 18 L 22 18 Z"
        fill={colorFor('B')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Mesial strip (left) */}
      <path
        d="M 18 4 L 22 18 L 22 42 L 18 54 Q 15 48 15 40 L 15 18 Q 15 10 18 4 Z"
        fill={colorFor('M')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Distal strip (right) */}
      <path
        d="M 42 4 L 38 18 L 38 42 L 42 54 Q 45 48 45 40 L 45 18 Q 45 10 42 4 Z"
        fill={colorFor('D')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Lingual strip (bottom) */}
      <path
        d="M 18 54 L 22 42 L 38 42 L 42 54 Q 38 56 34 56 L 26 56 Q 22 56 18 54 Z"
        fill={colorFor('L')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Incisal (mapped to 'O') — central flat area */}
      <rect
        x="22"
        y="18"
        width="16"
        height="24"
        fill={colorFor('O')}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Flat incisal edge marker */}
      <line
        x1="22"
        y1="21"
        x2="38"
        y2="21"
        stroke={CUSP_STROKE}
        strokeWidth={CUSP_STROKE_WIDTH}
        opacity="0.4"
      />
    </g>
  )
}
