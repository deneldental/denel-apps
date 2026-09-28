import { format, parseISO } from 'date-fns'
import { Database, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type BackupSchedule,
  getBackupStatus,
  SECRET_SENTINEL,
  saveBackup,
} from '@/lib/actions/integrations'
import { useApiMutation, useApiQuery } from '@/lib/query'
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
import { Switch } from '@/shared/components/ui/switch'

const BACKUP_KEY = ['integrations', 'backup'] as const

export function BackupConfigCard() {
  const query = useApiQuery(BACKUP_KEY, getBackupStatus)
  const status = query.data ?? null
  const loading = query.isLoading

  const saveMutation = useApiMutation(saveBackup, { invalidates: [BACKUP_KEY] })

  const [connectionString, setConnectionString] = useState('')
  const [schedule, setSchedule] = useState<BackupSchedule>('daily-6pm')
  const [targetProvider, setTargetProvider] = useState<'r2' | 'do_spaces'>('r2')
  const [enabled, setEnabled] = useState(false)
  const [revealConn, setRevealConn] = useState(false)

  useEffect(() => {
    if (!status) return
    setSchedule(status.schedule)
    setTargetProvider(status.targetProvider)
    setEnabled(status.enabled)
    setConnectionString(status.hasConnectionString ? SECRET_SENTINEL : '')
  }, [status])

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({ connectionString, schedule, targetProvider, enabled })
      toast.success('Backup configuration saved — scheduler restarted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const saving = saveMutation.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Database Backup
        </CardTitle>
        <CardDescription>
          Periodic <code>pg_dump</code> upload, kept private, to the Storage target chosen below
          (under <code>SYS/backups/</code>). Connection string is required and stays on the server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id="backup-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={loading || saving}
          />
          <Label htmlFor="backup-enabled" className="cursor-pointer">
            {enabled ? 'Enabled' : 'Disabled'}
          </Label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="backup-conn">Database connection string</Label>
          <div className="relative">
            <Input
              id="backup-conn"
              type={revealConn ? 'text' : 'password'}
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
              placeholder="postgresql://user:pass@host:5432/dbname"
              disabled={loading}
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setRevealConn((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title={revealConn ? 'Hide' : 'Reveal typed value'}
            >
              {revealConn ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {status?.connectionStringMasked && connectionString === SECRET_SENTINEL && (
            <p className="text-xs text-muted-foreground">Saved: {status.connectionStringMasked}</p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Schedule</Label>
            <Select value={schedule} onValueChange={(v) => setSchedule(v as BackupSchedule)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily-6pm">Daily at 6:00 PM</SelectItem>
                <SelectItem value="weekly-sunday-6pm">Weekly · Sunday 6:00 PM</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Storage target</Label>
            <Select
              value={targetProvider}
              onValueChange={(v) => setTargetProvider(v as 'r2' | 'do_spaces')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="r2">Cloudflare R2</SelectItem>
                <SelectItem value="do_spaces">DigitalOcean Spaces</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {status?.lastRunAt && (
          <p className="text-xs text-muted-foreground">
            Last run: {format(parseISO(status.lastRunAt), 'PPpp')} —{' '}
            <span
              className={
                status.lastStatus === 'ok' ? 'text-emerald-600' : 'text-destructive font-medium'
              }
            >
              {status.lastStatus}
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Requires <code>pg_dump</code> on the host PATH.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
