import { ShieldCheck, Tablet } from 'lucide-react'
import { toast } from 'sonner'
import { SettingsLoadError } from '@/features/settings/components/settings-load-error'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { useKvSetting } from '@/shared/hooks/use-kv-setting'

const KV_KIOSK_KEY = 'security:kiosk_config'
const KV_RETENTION_KEY = 'security:audit_retention'

/** Only the field the kiosk page reads (`features/kiosk/pages/index.tsx`). */
interface KioskConfig {
  idleLockSeconds: number
}

type RetentionPeriod = '90_days' | '180_days' | '1_year' | 'indefinite'

/** Read by the monthly audit-retention cron (backend `lib/cron/jobs/audit-retention.ts`). */
interface AuditRetention {
  retentionPeriod: RetentionPeriod
}

const DEFAULT_KIOSK: KioskConfig = { idleLockSeconds: 90 }
const DEFAULT_RETENTION: AuditRetention = { retentionPeriod: '1_year' }

const RETENTION_OPTIONS: ReadonlyArray<{ value: RetentionPeriod; label: string }> = [
  { value: '90_days', label: '90 Days' },
  { value: '180_days', label: '180 Days (6 Months)' },
  { value: '1_year', label: '1 Year (Recommended)' },
  { value: 'indefinite', label: 'Indefinite (Never purge)' },
]

function isRetentionPeriod(value: string): value is RetentionPeriod {
  return RETENTION_OPTIONS.some((o) => o.value === value)
}

export function SecurityKioskSection() {
  const kioskSetting = useKvSetting<KioskConfig>(KV_KIOSK_KEY, DEFAULT_KIOSK, {
    // Older rows also carry fields nothing reads; keep the draft to the one
    // field so a save writes exactly what the kiosk uses.
    fromStored: (stored) => {
      const raw =
        typeof stored === 'object' && stored !== null
          ? (stored as { idleLockSeconds?: unknown }).idleLockSeconds
          : undefined
      return { idleLockSeconds: typeof raw === 'number' ? raw : DEFAULT_KIOSK.idleLockSeconds }
    },
  })
  const retentionSetting = useKvSetting<AuditRetention>(KV_RETENTION_KEY, DEFAULT_RETENTION)
  const { value: kiosk, setValue: setKiosk } = kioskSetting
  const { value: retention, setValue: setRetention } = retentionSetting
  const loading = kioskSetting.loading || retentionSetting.loading
  const loadError = kioskSetting.loadError ?? retentionSetting.loadError
  // One key failing to load blocks the whole save — saving would write that
  // key's defaults over its stored value.
  const canSave = kioskSetting.canSave && retentionSetting.canSave
  const saving = kioskSetting.saving || retentionSetting.saving
  const refetch = () => {
    kioskSetting.refetch()
    retentionSetting.refetch()
  }

  async function handleSave() {
    try {
      await Promise.all([kioskSetting.save(), retentionSetting.save()])
      toast.success('Kiosk and retention policies saved')
    } catch {
      toast.error('Failed to save security settings')
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <SettingsLoadError error={loadError} onRetry={refetch} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tablet className="h-5 w-5 text-primary" />
            Patient Check-in Kiosk
          </CardTitle>
          <CardDescription>
            How long the reception check-in tablet may sit idle before it returns to the welcome
            screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="kiosk-timeout">Idle Screen Reset Timeout</Label>
              <Select
                value={String(kiosk.idleLockSeconds)}
                onValueChange={(v) => setKiosk({ idleLockSeconds: Number(v) })}
                disabled={loading}
              >
                <SelectTrigger id="kiosk-timeout">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 seconds (Quick reset)</SelectItem>
                  <SelectItem value="60">60 seconds (1 minute)</SelectItem>
                  <SelectItem value="90">90 seconds (1.5 minutes - Default)</SelectItem>
                  <SelectItem value="120">120 seconds (2 minutes)</SelectItem>
                  <SelectItem value="180">180 seconds (3 minutes)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Applied by the kiosk page on its next load.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Audit Log Retention
          </CardTitle>
          <CardDescription>
            The monthly retention job deletes audit-log entries older than this period. Sign-in
            attempt records are always kept for 30 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 max-w-sm">
            <Label htmlFor="retention-period">Log Retention Duration</Label>
            <Select
              value={retention.retentionPeriod}
              onValueChange={(v) => {
                if (isRetentionPeriod(v)) setRetention({ retentionPeriod: v })
              }}
              disabled={loading}
            >
              <SelectTrigger id="retention-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETENTION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="pt-4">
            <Button onClick={handleSave} disabled={!canSave || saving}>
              {saving ? 'Saving changes…' : 'Save security policies'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
