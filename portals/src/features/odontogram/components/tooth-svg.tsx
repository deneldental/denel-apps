import { memo, useCallback } from 'react'
import { CONDITION_COLORS, classifyTooth, type OdontogramEntry, type ToothSurface } from '../types'
import { CanineShape, IncisorShape, MolarShape, PremolarShape } from './tooth-shapes'

interface ToothSVGProps {
  toothNumber: number
  entries: OdontogramEntry[]
  /**
   * Stable per-tooth selection callback. The component derives a stable
   * onClick from this using `useCallback` so `React.memo` can actually skip
   * renders across the 32-tooth chart.
   */
  onSelect?: (toothNumber: number) => void
  size?: number
  /** What to print for the tooth (the configured notation); defaults to the FDI number. */
  label?: string
}

/**
 * Renders a single tooth as an SVG. Dispatches to an anatomical silhouette
 * based on FDI position — incisor, canine, premolar, or molar.
 *
 * The whole tooth is one click target; per-surface interaction happens in
 * the detail dialog (this component is purely visual). Surface colors use
 * the same B/M/D/L/O mapping for all tooth kinds — the `O` surface
 * represents the occlusal face on posteriors and the incisal face on
 * anteriors. Data model is unchanged.
 *
 * Wrapped in `React.memo` so that clicking one tooth doesn't re-render the
 * other 31 — combined with a stable `entries` reference from the parent, the
 * chart's render cost per click collapses to O(1) instead of O(32).
 */
function ToothSVGInner({ toothNumber, entries, onSelect, size = 60, label }: ToothSVGProps) {
  const handleClick = useCallback(() => {
    onSelect?.(toothNumber)
  }, [onSelect, toothNumber])
  const surfaceMap: Partial<Record<ToothSurface, OdontogramEntry>> = {}
  for (const e of entries) surfaceMap[e.surface] = e

  const colorFor = (surface: Exclude<ToothSurface, 'whole'>): string => {
    const entry = surfaceMap[surface]
    if (!entry) return '#ffffff'
    return CONDITION_COLORS[entry.condition as keyof typeof CONDITION_COLORS] ?? '#e5e7eb'
  }

  // Whole-tooth-level conditions (extracted/missing/implant/bridge) override
  // per-surface colors and paint the full outer silhouette.
  const wholeEntry = surfaceMap.whole
  const wholeColor = wholeEntry
    ? CONDITION_COLORS[wholeEntry.condition as keyof typeof CONDITION_COLORS]
    : null

  const kind = classifyTooth(toothNumber)
  const stroke = '#9ca3af'

  // Whole-tooth overlay replaces the anatomical shape with a uniform filled
  // rectangle so the condition reads cleanly at a glance.
  const renderWholeTooth = () => (
    <rect
      x="2"
      y="2"
      width="56"
      height="56"
      fill={wholeColor!}
      stroke={stroke}
      strokeWidth="1"
      rx="4"
    />
  )

  const renderAnatomicalShape = () => {
    const shapeProps = { colorFor, stroke }
    switch (kind) {
      case 'molar':
        return <MolarShape {...shapeProps} />
      case 'premolar':
        return <PremolarShape {...shapeProps} />
      case 'canine':
        return <CanineShape {...shapeProps} />
      case 'incisor':
        return <IncisorShape {...shapeProps} />
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group relative inline-flex flex-col items-center gap-0.5 focus:outline-none"
      title={`Tooth ${label ?? toothNumber}`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 60 60"
        className="transition-transform group-hover:scale-110"
      >
        {wholeColor ? renderWholeTooth() : renderAnatomicalShape()}

        {/* "X" overlay for extracted / missing */}
        {wholeEntry &&
          (wholeEntry.condition === 'extracted' || wholeEntry.condition === 'missing') && (
            <>
              <line x1="8" y1="8" x2="52" y2="52" stroke="#ef4444" strokeWidth="3" />
              <line x1="52" y1="8" x2="8" y2="52" stroke="#ef4444" strokeWidth="3" />
            </>
          )}
      </svg>
      <span className="text-[10px] font-mono text-muted-foreground">{label ?? toothNumber}</span>
    </button>
  )
}

export const ToothSVG = memo(ToothSVGInner)
