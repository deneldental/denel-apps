import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  FileJson,
  Loader2,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  clearServiceAccountConfig,
  getServiceAccountConfig,
  type ServiceAccountStatus,
  saveServiceAccountConfig,
  testServiceAccountConfig,
} from '@/lib/actions/google-calendar'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Textarea } from '@/shared/components/ui/textarea'

interface Props {
  /** Whether SA is the currently active auth method (drives the "Active" badge). */
  isActive: boolean
  onSaved?: () => void
}

const GOOGLE_SERVICE_ACCOUNT_KEY = ['integrations', 'google-calendar', 'service-account'] as const

export function GoogleServiceAccountCard({ isActive, onSaved }: Props) {
  const query = useApiQuery(GOOGLE_SERVICE_ACCOUNT_KEY, getServiceAccountConfig)
  const status: ServiceAccountStatus | null = query.data ?? null
  const loading = query.isLoading
  const forbidden = query.error instanceof Error && /forbidden/i.test(query.error.message)

  const saveMutation = useApiMutation(saveServiceAccountConfig, {
    invalidates: [GOOGLE_SERVICE_ACCOUNT_KEY],
  })
  const clearMutation = useApiMutation(clearServiceAccountConfig, {
    invalidates: [GOOGLE_SERVICE_ACCOUNT_KEY],
  })

  const [testing, setTesting] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const [clientEmail, setClientEmail] = useState('')
  const [calendarId, setCalendarId] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    reason?: string
    detail?: string
  } | null>(null)

  useEffect(() => {
    if (!status) return
    setClientEmail(status.clientEmail ?? '')
    setCalendarId(status.calendarId ?? '')
    setPrivateKey('')
  }, [status])

  function handlePasteJson(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const raw = e.target.value
    if (!raw.trim()) return
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        if (typeof parsed.client_email === 'string') setClientEmail(parsed.client_email)
        if (typeof parsed.private_key === 'string') {
          setPrivateKey(parsed.private_key)
          toast.success('Filled service-account fields from JSON key')
        }
      }
    } catch {
      // Not JSON — treat as a literal PEM paste
    }
  }

  async function handleSave() {
    if (!clientEmail.trim()) {
      toast.error('Service-account email is required')
      return
    }
    if (!calendarId.trim()) {
      toast.error('Calendar ID is required')
      return
    }
    if (!status?.hasPrivateKey && !privateKey.trim()) {
      toast.error('Private key is required on first save')
      return
    }
    try {
      await saveMutation.mutateAsync({
        clientEmail: clientEmail.trim(),
        privateKey: privateKey.trim() || null,
        calendarId: calendarId.trim(),
      })
      toast.success('Service account config saved')
      setPrivateKey('')
      setTestResult(null)
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const res = await testServiceAccountConfig()
    setTesting(false)
    if (res.success && res.data) setTestResult(res.data)
    else toast.error(res.error || 'Test failed')
  }

  async function handleClear() {
    try {
      await clearMutation.mutateAsync()
      setShowClearConfirm(false)
      toast.success('Service account config cleared')
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear')
    }
  }

  const saving = saveMutation.isPending
  const clearing = clearMutation.isPending

  if (forbidden) return null

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Service Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={isActive ? '' : 'opacity-75'}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5" />
              Service Account
              {isActive && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-emerald-300 text-emerald-700"
                >
                  Active
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              The service account auto-provisions a dedicated Google calendar for each doctor and
              shares it with them (reader). Each doctor sees only their own appointments. The
              calendar ID below is used as an admin overview / fallback only.
            </CardDescription>
          </div>
          {status?.source === 'db' && (
            <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">
              Configured
            </Badge>
          )}
          {status?.source === 'none' && (
            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
              Not configured
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isActive && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Inactive</AlertTitle>
            <AlertDescription>
              OAuth is the active method right now. You can still save credentials here — they'll
              take effect as soon as you switch the auth method to Service Account above.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="sa-json">Paste service-account JSON key (optional shortcut)</Label>
          <Textarea
            id="sa-json"
            rows={3}
            placeholder='Paste the contents of the .json file downloaded from GCP — fills "Service account email" and "Private key" automatically.'
            onChange={handlePasteJson}
            className="font-mono text-[11px]"
            disabled={saving}
          />
          <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <FileJson className="h-3 w-3" />
            Or fill the fields below manually.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sa-email">Service account email</Label>
          <Input
            id="sa-email"
            type="email"
            placeholder="framada-calendar@your-project.iam.gserviceaccount.com"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sa-private-key">
            Private key (PEM)
            {status?.hasPrivateKey && (
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                Already saved — leave blank to keep current
              </span>
            )}
          </Label>
          <div className="relative">
            <Textarea
              id="sa-private-key"
              rows={4}
              placeholder={
                status?.hasPrivateKey
                  ? '••••••••'
                  : '-----BEGIN PRIVATE KEY-----\\nMIIEvQI...\\n-----END PRIVATE KEY-----'
              }
              value={showPrivateKey ? privateKey : privateKey ? '•'.repeat(40) : ''}
              onChange={(e) => setPrivateKey(e.target.value)}
              disabled={saving}
              className="font-mono text-[11px] pr-10"
            />
            <button
              type="button"
              aria-label={showPrivateKey ? 'Hide key' : 'Show key'}
              onClick={() => setShowPrivateKey((s) => !s)}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
            >
              {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Stored encrypted (AES-256-GCM). Never returned after save.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sa-calendar-id">Admin overview / fallback calendar ID</Label>
          <Input
            id="sa-calendar-id"
            placeholder="abc123@group.calendar.google.com"
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            disabled={saving}
          />
          <p className="text-[11px] text-muted-foreground">
            Used only when a doctor has no specialist record (legacy data) — appointments fall back
            here so they still sync somewhere. Create a calendar in Google Calendar, share it with
            the service-account email (Make changes AND manage sharing), then paste its Calendar ID
            here. Found under "Integrate calendar" in calendar settings.
          </p>
        </div>

        {testResult && (
          <div
            className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
              testResult.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
                : 'border-red-200 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="font-medium">
                {testResult.ok
                  ? 'Verified — service account can write to the calendar.'
                  : `Test failed: ${testResult.reason ?? 'unknown reason'}`}
              </p>
              {testResult.detail && !testResult.ok && (
                <p className="mt-1 font-mono text-[10px] break-all opacity-80">
                  {testResult.detail}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
            {status?.source === 'db' && (
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Test connection
              </Button>
            )}
          </div>
          {status?.source === 'db' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              disabled={clearing}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Clear
            </Button>
          )}
        </div>
      </CardContent>

      <DeleteConfirmationDialog
        open={showClearConfirm}
        onOpenChange={(open) => !open && setShowClearConfirm(false)}
        onConfirm={handleClear}
        isLoading={clearing}
        title="Clear service account config?"
        description={
          isActive
            ? 'Service Account is the active auth method — clearing now will stop all Google Calendar sync until either credentials are re-added OR you switch back to OAuth.'
            : 'The DB-backed service account credentials will be removed.'
        }
      />
    </Card>
  )
}
