import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToothNotation } from '@/features/clinical/use-clinical-preferences'
import { api } from '@/lib/api-client'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  ALL_CONDITIONS,
  CONDITION_COLORS,
  CONDITION_LABELS,
  LOWER_TEETH,
  type OdontogramEntry,
  UPPER_TEETH,
} from '../types'
import { ToothDetailDialog } from './tooth-detail-dialog'
import { ToothSVG } from './tooth-svg'

interface OdontogramChartProps {
  patientId: string
  canEdit?: boolean
}

const EMPTY_ENTRIES: OdontogramEntry[] = []

export function OdontogramChart({ patientId, canEdit = true }: OdontogramChartProps) {
  const { toothLabel, notationLabel } = useToothNotation()
  const [entries, setEntries] = useState<OdontogramEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<OdontogramEntry[]>(`/api/odontogram/patient/${patientId}`)
    if (res.success && res.data) setEntries(res.data)
    setLoading(false)
  }, [patientId])

  useEffect(() => {
    load()
  }, [load])

  // Group entries by tooth number ONCE per entries change so each ToothSVG
  // gets a referentially-stable array. Without this, selecting a tooth
  // re-ran `filter()` for all 32 teeth and created fresh arrays, defeating
  // React.memo on ToothSVG and re-rendering the whole chart on every click.
  const entriesByTooth = useMemo(() => {
    const map = new Map<number, OdontogramEntry[]>()
    for (const e of entries) {
      const list = map.get(e.toothNumber)
      if (list) list.push(e)
      else map.set(e.toothNumber, [e])
    }
    return map
  }, [entries])

  const entriesForTooth = (toothNumber: number): OdontogramEntry[] =>
    entriesByTooth.get(toothNumber) ?? EMPTY_ENTRIES

  // Stable selection handler — prevents each of the 32 `<ToothSVG>` nodes
  // from receiving a fresh `onSelect` prop per render (which would defeat
  // `React.memo`).
  const handleToothSelect = useCallback((tooth: number) => {
    setSelectedTooth(tooth)
  }, [])

  const handleDialogClose = useCallback(() => {
    setSelectedTooth(null)
  }, [])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold">Odontogram</h3>
        <p className="text-xs text-muted-foreground">
          {notationLabel} notation. Click any tooth to view or record conditions.
        </p>
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        {/* Upper arch */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
              Upper
            </span>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span>Patient Right →</span>
              <span>← Patient Left</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-1 sm:gap-1.5">
            {UPPER_TEETH.map((tooth, idx) => (
              <div key={tooth} className={idx === 8 ? 'ml-3 border-l border-border pl-3' : ''}>
                <ToothSVG
                  toothNumber={tooth}
                  label={toothLabel(tooth)}
                  entries={entriesForTooth(tooth)}
                  onSelect={handleToothSelect}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Divider between arches */}
        <div className="border-t border-dashed border-border" />

        {/* Lower arch */}
        <div>
          <div className="flex flex-wrap justify-center gap-1 sm:gap-1.5">
            {LOWER_TEETH.map((tooth, idx) => (
              <div key={tooth} className={idx === 8 ? 'ml-3 border-l border-border pl-3' : ''}>
                <ToothSVG
                  toothNumber={tooth}
                  label={toothLabel(tooth)}
                  entries={entriesForTooth(tooth)}
                  onSelect={handleToothSelect}
                />
              </div>
            ))}
          </div>
          <div className="text-center mt-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
              Lower
            </span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">
          Legend
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-3 gap-y-1.5">
          {ALL_CONDITIONS.map((c) => (
            <div key={c} className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 rounded border border-border shrink-0"
                style={{ backgroundColor: CONDITION_COLORS[c] }}
              />
              <span className="text-xs">{CONDITION_LABELS[c]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tooth detail dialog */}
      <ToothDetailDialog
        patientId={patientId}
        toothNumber={selectedTooth}
        toothLabel={selectedTooth != null ? toothLabel(selectedTooth) : undefined}
        open={selectedTooth != null}
        entries={selectedTooth != null ? entriesForTooth(selectedTooth) : EMPTY_ENTRIES}
        onClose={handleDialogClose}
        onChange={load}
        canEdit={canEdit}
      />
    </div>
  )
}
