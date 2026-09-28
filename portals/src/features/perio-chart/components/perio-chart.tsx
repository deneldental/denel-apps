import { format } from 'date-fns'
import { Plus, Save, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { perioLegend } from '@/features/clinical/preferences'
import {
  useClinicalPreferences,
  useToothNotation,
} from '@/features/clinical/use-clinical-preferences'
import { api } from '@/lib/api-client'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  BUCCAL_SITES,
  depthColor,
  LINGUAL_SITES,
  LOWER_TEETH,
  PERIO_SITES,
  type PerioExam,
  type PerioSite,
  UPPER_TEETH,
} from '../types'

interface PerioChartProps {
  patientId: string
  canEdit?: boolean
}

type Draft = Record<number, Record<PerioSite, number | null>>

function makeEmptyDraft(): Draft {
  const d: Draft = {} as Draft
  for (const t of [...UPPER_TEETH, ...LOWER_TEETH]) {
    d[t] = { MB: null, B: null, DB: null, ML: null, L: null, DL: null }
  }
  return d
}

export function PerioChart({ patientId, canEdit = true }: PerioChartProps) {
  const { perio: thresholds } = useClinicalPreferences()
  const { toothLabel } = useToothNotation()
  const legend = perioLegend(thresholds)
  const [exams, setExams] = useState<PerioExam[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedExamId, setSelectedExamId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(makeEmptyDraft)
  const [saving, setSaving] = useState(false)
  const [deleteExamId, setDeleteExamId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<PerioExam[]>(`/api/perio-chart/patient/${patientId}`)
    if (res.success && res.data) {
      setExams(res.data)
      if (res.data.length > 0 && selectedExamId !== 'new') setSelectedExamId(res.data[0].examId)
    } else {
      setExams([])
    }
    setLoading(false)
  }, [patientId, selectedExamId])

  useEffect(() => {
    load()
  }, [load])

  function startNewExam() {
    setDraft(makeEmptyDraft())
    setSelectedExamId('new')
  }

  function cancelNewExam() {
    setDraft(makeEmptyDraft())
    setSelectedExamId(exams[0]?.examId ?? null)
  }

  function setDraftValue(tooth: number, site: PerioSite, raw: string) {
    const num = raw === '' ? null : Math.max(0, Math.min(20, parseInt(raw, 10)))
    if (num !== null && Number.isNaN(num)) return
    setDraft((prev) => ({
      ...prev,
      [tooth]: { ...prev[tooth], [site]: num },
    }))
  }

  async function saveExam() {
    const readings: Array<{ toothNumber: number; site: PerioSite; pocketDepth: number }> = []
    for (const [toothStr, sites] of Object.entries(draft)) {
      const tooth = parseInt(toothStr, 10)
      for (const s of PERIO_SITES) {
        const v = sites[s]
        if (v != null) readings.push({ toothNumber: tooth, site: s, pocketDepth: v })
      }
    }
    if (readings.length === 0) {
      toast.error('Enter at least one pocket depth reading')
      return
    }
    setSaving(true)
    const examId = crypto.randomUUID()
    const res = await api.post('/api/perio-chart', { patientId, examId, readings })
    setSaving(false)
    if (res.success) {
      toast.success(`Perio exam saved (${readings.length} readings)`)
      setSelectedExamId(null)
      await load()
    } else {
      toast.error((res.error as string) || 'Failed to save')
    }
  }

  async function confirmDeleteExam() {
    if (!deleteExamId) return
    const res = await api.delete(`/api/perio-chart/exam/${deleteExamId}`)
    if (res.success) {
      toast.success('Perio exam deleted')
      setDeleteExamId(null)
      setSelectedExamId(null)
      await load()
    } else {
      toast.error('Failed to delete')
      throw new Error('delete failed')
    }
  }

  const currentExam =
    selectedExamId === 'new' ? null : exams.find((e) => e.examId === selectedExamId)

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    )
  }

  const isEditing = selectedExamId === 'new'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold">Perio Chart</h3>
          <p className="text-xs text-muted-foreground">
            Pocket depth readings (mm). 6 sites per tooth.
          </p>
        </div>

        {/* Exam selector */}
        <div className="flex items-center gap-2">
          {!isEditing && exams.length > 0 && (
            <Select value={selectedExamId ?? ''} onValueChange={(v) => setSelectedExamId(v)}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select exam" />
              </SelectTrigger>
              <SelectContent>
                {exams.map((e) => (
                  <SelectItem key={e.examId} value={e.examId}>
                    {(() => {
                      try {
                        return format(new Date(e.recordedAt), 'MMM d, yyyy h:mm a')
                      } catch {
                        return e.recordedAt
                      }
                    })()} ({e.entries.length} readings)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canEdit && !isEditing && (
            <Button size="sm" onClick={startNewExam}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Exam
            </Button>
          )}
          {canEdit && currentExam && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setDeleteExamId(currentExam.examId)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!isEditing && exams.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">No perio exams recorded yet.</p>
          {canEdit && (
            <Button size="sm" onClick={startNewExam}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Start New Exam
            </Button>
          )}
        </div>
      )}

      {/* Chart grid */}
      {(isEditing || currentExam) && (
        <div className="space-y-6">
          {[
            { teeth: UPPER_TEETH, label: 'Upper' },
            { teeth: LOWER_TEETH, label: 'Lower' },
          ].map(({ teeth, label }) => (
            <div key={label} className="rounded-xl border border-border bg-card overflow-x-auto">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
                <span className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                  {label} Arch
                </span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/20">
                    <th className="p-1.5 text-left text-[10px] font-medium text-muted-foreground w-24">
                      Site
                    </th>
                    {teeth.map((t, idx) => (
                      <th
                        key={t}
                        className={`p-1.5 font-mono text-[10px] text-center ${idx === 8 ? 'border-l border-border' : ''}`}
                      >
                        {toothLabel(t)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Buccal group */}
                  {BUCCAL_SITES.map((site) => (
                    <tr key={`${label}-${site}`} className="border-t border-border">
                      <td className="p-1.5 text-muted-foreground font-medium text-[10px]">
                        {site}
                      </td>
                      {teeth.map((tooth, idx) => {
                        const v = isEditing
                          ? draft[tooth][site]
                          : (currentExam?.entries.find(
                              (e) => e.toothNumber === tooth && e.site === site
                            )?.pocketDepth ?? null)
                        return (
                          <td
                            key={`${tooth}-${site}`}
                            className={`p-0.5 text-center ${idx === 8 ? 'border-l border-border' : ''}`}
                          >
                            {isEditing ? (
                              <input
                                type="number"
                                min={0}
                                max={20}
                                value={v ?? ''}
                                onChange={(e) => setDraftValue(tooth, site, e.target.value)}
                                className="w-9 h-7 text-center text-xs rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            ) : v != null ? (
                              <span
                                className={`inline-block min-w-[24px] rounded text-center py-0.5 ${depthColor(v, thresholds)}`}
                              >
                                {v}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {/* Divider */}
                  <tr>
                    <td
                      colSpan={teeth.length + 1}
                      className="border-t-2 border-dashed border-border"
                    />
                  </tr>
                  {/* Lingual group */}
                  {LINGUAL_SITES.map((site) => (
                    <tr key={`${label}-${site}`} className="border-t border-border">
                      <td className="p-1.5 text-muted-foreground font-medium text-[10px]">
                        {site}
                      </td>
                      {teeth.map((tooth, idx) => {
                        const v = isEditing
                          ? draft[tooth][site]
                          : (currentExam?.entries.find(
                              (e) => e.toothNumber === tooth && e.site === site
                            )?.pocketDepth ?? null)
                        return (
                          <td
                            key={`${tooth}-${site}`}
                            className={`p-0.5 text-center ${idx === 8 ? 'border-l border-border' : ''}`}
                          >
                            {isEditing ? (
                              <input
                                type="number"
                                min={0}
                                max={20}
                                value={v ?? ''}
                                onChange={(e) => setDraftValue(tooth, site, e.target.value)}
                                className="w-9 h-7 text-center text-xs rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            ) : v != null ? (
                              <span
                                className={`inline-block min-w-[24px] rounded text-center py-0.5 ${depthColor(v, thresholds)}`}
                              >
                                {v}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {isEditing && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={cancelNewExam}>
                <X className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button size="sm" onClick={saveExam} disabled={saving}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? 'Saving…' : 'Save Exam'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      {!isEditing && currentExam && (
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
              {legend.healthy}
            </span>
            <span className="text-muted-foreground">Healthy</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
              {legend.moderate}
            </span>
            <span className="text-muted-foreground">Moderate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200">
              {legend.severe}
            </span>
            <span className="text-muted-foreground">Severe</span>
          </div>
        </div>
      )}

      <DeleteConfirmationDialog
        open={!!deleteExamId}
        onOpenChange={(o) => !o && setDeleteExamId(null)}
        onConfirm={confirmDeleteExam}
        title="Delete perio exam?"
        description="The exam and all of its readings will be permanently removed."
      />
    </div>
  )
}
