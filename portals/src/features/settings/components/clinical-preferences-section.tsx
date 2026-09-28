import { isToothNotation } from '@denel/utils'
import { Activity, FlaskConical, Stethoscope } from 'lucide-react'
import { toast } from 'sonner'
import {
  CHARTING_KEY,
  type ChartingPreferences,
  DEFAULT_CHARTING,
  DEFAULT_PERIO,
  mergeChartingPreferences,
  mergePerioThresholds,
  PERIO_KEY,
  type PerioThresholds,
} from '@/features/clinical/preferences'
import { SettingsLoadError } from '@/features/settings/components/settings-load-error'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { useKvSetting } from '@/shared/hooks/use-kv-setting'

/**
 * Settings → Clinical → Charting Preferences. Every field here is read
 * somewhere (settings-domain-audit S5-B): notation by every tooth display in
 * the portal, prescription days by the case prescription stage, the lab
 * turnaround by lab-case creation, the perio thresholds by the perio chart
 * and the clinical analytics page. `deciduousNotation` is the one exception —
 * stored for when primary dentition charting exists, and labelled as such.
 */
export function ClinicalPreferencesSection() {
  const chartingSetting = useKvSetting<ChartingPreferences>(CHARTING_KEY, DEFAULT_CHARTING, {
    fromStored: mergeChartingPreferences,
  })
  const perioSetting = useKvSetting<PerioThresholds>(PERIO_KEY, DEFAULT_PERIO, {
    fromStored: mergePerioThresholds,
  })
  const { value: charting, setValue: setCharting } = chartingSetting
  const { value: perio, setValue: setPerio } = perioSetting
  const loading = chartingSetting.loading || perioSetting.loading
  const loadError = chartingSetting.loadError ?? perioSetting.loadError
  // One key failing to load blocks the whole save — saving would write that
  // key's defaults over its stored value.
  const canSave = chartingSetting.canSave && perioSetting.canSave
  const saving = chartingSetting.saving || perioSetting.saving
  const perioOrdered =
    perio.normalMaxMm < perio.moderateMaxMm && perio.moderateMaxMm < perio.severeMinMm
  const refetch = () => {
    chartingSetting.refetch()
    perioSetting.refetch()
  }

  async function handleSave() {
    if (!perioOrdered) {
      toast.error('Perio thresholds must increase: healthy max < moderate max < severe min')
      return
    }
    try {
      await Promise.all([chartingSetting.save(), perioSetting.save()])
      toast.success('Clinical & odontogram preferences saved')
    } catch {
      toast.error('Failed to save clinical preferences')
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <SettingsLoadError error={loadError} onRetry={refetch} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-primary" />
            Dental Charting & Notation Preferences
          </CardTitle>
          <CardDescription>
            How tooth numbers are shown across the portal — odontogram, perio chart, treatment plans
            and x-rays. Records always store FDI numbers, so switching is safe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="notation-system">Permanent Teeth Notation</Label>
              <Select
                value={charting.notationSystem}
                onValueChange={(v) => {
                  if (isToothNotation(v)) setCharting({ ...charting, notationSystem: v })
                }}
                disabled={loading}
              >
                <SelectTrigger id="notation-system">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fdi">
                    FDI World Dental Federation (11–48) [Recommended]
                  </SelectItem>
                  <SelectItem value="universal">Universal Numbering System (1–32)</SelectItem>
                  <SelectItem value="palmer">Palmer Notation (UR1–LL8)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Applies to every tooth label and picker in the portal. The Team and Patient apps
                keep FDI.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deciduous-notation">Primary / Deciduous Teeth Notation</Label>
              <Select
                value={charting.deciduousNotation}
                onValueChange={(v) =>
                  setCharting({ ...charting, deciduousNotation: v === 'letter' ? 'letter' : 'fdi' })
                }
                disabled={loading}
              >
                <SelectTrigger id="deciduous-notation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fdi">FDI Two-Digit (51–85)</SelectItem>
                  <SelectItem value="letter">Alphabetical Letters (A–T)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Stored for when primary dentition charting exists; nothing reads it yet.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rx-duration">Default Prescription Course (Days)</Label>
              <Select
                value={String(charting.defaultPrescriptionDays)}
                onValueChange={(v) =>
                  setCharting({ ...charting, defaultPrescriptionDays: Number(v) })
                }
                disabled={loading}
              >
                <SelectTrigger id="rx-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 Days (Short course / Analgesics)</SelectItem>
                  <SelectItem value="5">5 Days (Standard Antibiotic)</SelectItem>
                  <SelectItem value="7">7 Days (Full Antibiotic regimen)</SelectItem>
                  <SelectItem value="10">10 Days</SelectItem>
                  <SelectItem value="14">14 Days (Extended regimen)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                New drug rows in a case's prescription stage start with this duration; each row
                stays editable.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Periodontal Probing Depth Severity Thresholds
          </CardTitle>
          <CardDescription>
            Colour the perio chart's readings and legend, and set when the clinical analytics
            average-depth tile turns to a warning (above the healthy maximum).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 p-3 rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50">
              <div className="font-semibold text-xs text-emerald-800 dark:text-emerald-300">
                Healthy / Mild Sulcus
              </div>
              <Label htmlFor="normal-max" className="text-xs">
                Max Depth (mm)
              </Label>
              <Input
                id="normal-max"
                type="number"
                min={1}
                max={5}
                value={perio.normalMaxMm}
                onChange={(e) => setPerio({ ...perio, normalMaxMm: Number(e.target.value) || 3 })}
                disabled={loading}
              />
              <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Highlighted in Green (&le; {perio.normalMaxMm}mm)
              </span>
            </div>

            <div className="space-y-2 p-3 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50">
              <div className="font-semibold text-xs text-amber-800 dark:text-amber-300">
                Moderate Pocket
              </div>
              <Label htmlFor="moderate-max" className="text-xs">
                Max Depth (mm)
              </Label>
              <Input
                id="moderate-max"
                type="number"
                min={2}
                max={10}
                value={perio.moderateMaxMm}
                onChange={(e) => setPerio({ ...perio, moderateMaxMm: Number(e.target.value) || 5 })}
                disabled={loading}
              />
              <span className="text-[11px] text-amber-700 dark:text-amber-400">
                Highlighted in Yellow ({perio.normalMaxMm + 1}–{perio.moderateMaxMm}mm; readings
                below the severe minimum stay yellow)
              </span>
            </div>

            <div className="space-y-2 p-3 rounded-lg border bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50">
              <div className="font-semibold text-xs text-red-800 dark:text-red-300">
                Deep / Severe Periodontitis
              </div>
              <Label htmlFor="severe-min" className="text-xs">
                Min Depth (mm)
              </Label>
              <Input
                id="severe-min"
                type="number"
                min={3}
                max={12}
                value={perio.severeMinMm}
                onChange={(e) => setPerio({ ...perio, severeMinMm: Number(e.target.value) || 6 })}
                disabled={loading}
              />
              <span className="text-[11px] text-red-700 dark:text-red-400">
                Highlighted in Red (&ge; {perio.severeMinMm}mm)
              </span>
            </div>
          </div>
          {!perioOrdered && (
            <p className="text-xs text-destructive">
              Thresholds must increase: healthy max &lt; moderate max &lt; severe min.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Lab Turnaround Fallback
          </CardTitle>
          <CardDescription>
            Expected return dates come from the vendor's express option, then its regular
            turnaround, then the base service. When none of those is set, this is used — both when a
            case is created and to seed the date in the new-case form.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 max-w-xs">
            <Label htmlFor="lab-turnaround" className="text-xs">
              Default turnaround
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="lab-turnaround"
                type="number"
                min={1}
                value={charting.defaultLabTurnaroundDays}
                onChange={(e) =>
                  setCharting({
                    ...charting,
                    defaultLabTurnaroundDays: Math.max(1, Number(e.target.value) || 7),
                  })
                }
                disabled={loading}
              />
              <span className="text-xs text-muted-foreground">days</span>
            </div>
          </div>

          <div className="pt-4">
            <Button onClick={handleSave} disabled={!canSave || saving}>
              {saving ? 'Saving changes…' : 'Save clinical preferences'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
