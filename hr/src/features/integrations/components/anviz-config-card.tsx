import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@denel/ui'
import { AlertCircle, Check, Clock, Copy, Eye, EyeOff, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type AnvizStatus,
  getAnvizSecret,
  getAnvizStatus,
  SECRET_SENTINEL,
  saveAnviz,
  startAnvizApiPolling,
  testAnvizApi,
  testAnvizWebhook,
} from '@/lib/actions/integrations'

export function AnvizConfigCard() {
  const [status, setStatus] = useState<AnvizStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Test states
  const [testingWebhook, setTestingWebhook] = useState(false)
  const [webhookTestResult, setWebhookTestResult] = useState<{
    ok: boolean
    error?: string
  } | null>(null)

  const [testingApi, setTestingApi] = useState(false)
  const [apiTestResult, setApiTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  // Form states
  const [webhookPassword, setWebhookPassword] = useState('')
  const [storedPassword, setStoredPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [apiRegion, setApiRegion] = useState<'us' | 'ap' | 'eu'>('us')

  // Effective password for URL display and tests: use the value the user has
  // typed into the form (empty means intentionally cleared), unless the field
  // still shows the saved sentinel, in which case fall back to the stored secret.
  const effectivePassword = webhookPassword !== SECRET_SENTINEL ? webhookPassword : storedPassword

  // Reveal toggles
  const [revealWebhookPass, setRevealWebhookPass] = useState(false)
  const [revealApiSecret, setRevealApiSecret] = useState(false)

  // Polling test states
  const [pollingActive, setPollingActive] = useState(false)
  const [pollingTimeLeft, setPollingTimeLeft] = useState(0)

  useEffect(() => {
    if (!pollingActive || pollingTimeLeft <= 0) {
      if (pollingActive) {
        setPollingActive(false)
      }
      return
    }

    const timer = setTimeout(() => {
      setPollingTimeLeft((t) => t - 1)
    }, 1000)

    return () => clearTimeout(timer)
  }, [pollingActive, pollingTimeLeft])

  const load = () => {
    setLoading(true)
    Promise.all([getAnvizStatus(), getAnvizSecret()]).then(([statusRes, secretRes]) => {
      if (statusRes.success && statusRes.data) {
        setStatus(statusRes.data)
        setWebhookPassword(statusRes.data.hasWebhookPassword ? SECRET_SENTINEL : '')
        setApiKey(statusRes.data.hasApiKey ? SECRET_SENTINEL : '')
        setApiSecret(statusRes.data.hasApiSecret ? SECRET_SENTINEL : '')
        setApiRegion(statusRes.data.apiRegion || 'us')
      }
      if (secretRes.success && secretRes.data) {
        setStoredPassword(secretRes.data.webhookPassword || '')
      }
      setLoading(false)
    })
  }

  useEffect(load, [])

  const handleSave = async () => {
    setSaving(true)
    const res = await saveAnviz({ webhookPassword, apiKey, apiSecret, apiRegion })
    setSaving(false)
    if (res.success) {
      toast.success('Anviz integration settings saved successfully')
      setWebhookTestResult(null)
      setApiTestResult(null)
      // Optimistically keep the newly-typed password in state so the URL keeps
      // showing it while the full refresh is in flight.
      if (webhookPassword && webhookPassword !== SECRET_SENTINEL) {
        setStoredPassword(webhookPassword)
      }
      load()
    } else {
      toast.error(res.error || 'Failed to save settings')
    }
  }

  const handleTestWebhook = async () => {
    setTestingWebhook(true)
    setWebhookTestResult(null)
    const res = await testAnvizWebhook({ webhookPassword: effectivePassword || undefined })
    setTestingWebhook(false)
    if (res.success && res.data) {
      setWebhookTestResult(res.data)
    } else {
      setWebhookTestResult({ ok: false, error: res.error || 'Webhook test failed' })
    }
  }

  const handleTestApi = async () => {
    setTestingApi(true)
    setApiTestResult(null)
    const res = await testAnvizApi({ apiKey, apiSecret, apiRegion })
    setTestingApi(false)
    if (res.success && res.data) {
      setApiTestResult(res.data)
    } else {
      setApiTestResult({ ok: false, error: res.error || 'API test failed' })
    }
  }

  const handleStartPolling = async () => {
    setApiTestResult(null)
    const res = await startAnvizApiPolling()
    if (res.success) {
      setPollingActive(true)
      setPollingTimeLeft(120)
      toast.success(res.message || 'Background polling started for 2 minutes!')
    } else {
      toast.error(res.error || 'Failed to start API polling test')
    }
  }

  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          Anviz Attendance Integration
        </CardTitle>
        <CardDescription>
          Synchronize clock-in/out records from your Anviz CrossChex Cloud biometric devices.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Webhook Configuration Section */}
        <div className="space-y-4 border-b pb-6">
          <h3 className="text-sm font-semibold text-foreground">
            1. Webhook Settings (Device to Server)
          </h3>
          <p className="text-xs text-muted-foreground">
            Configure this endpoint in your Anviz CrossChex developer dashboard under webhook
            settings so check-ins are pushed to your server instantly.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 col-span-2 md:col-span-1">
              <Label htmlFor="an-webhook-url">Receiver URL</Label>
              <div className="flex gap-2">
                <Input
                  id="an-webhook-url"
                  value={
                    status?.webhookUrl
                      ? `${status.webhookUrl}${effectivePassword ? `?password=${encodeURIComponent(effectivePassword)}` : ''}`
                      : 'Loading...'
                  }
                  readOnly
                  disabled
                  className="bg-muted text-xs font-mono select-all flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    if (status?.webhookUrl) {
                      const suffix = effectivePassword
                        ? `?password=${encodeURIComponent(effectivePassword)}`
                        : ''
                      navigator.clipboard.writeText(`${status.webhookUrl}${suffix}`)
                      toast.success('Webhook URL copied to clipboard')
                    }
                  }}
                  disabled={!status?.webhookUrl}
                  title="Copy URL"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                <strong>Auth Note:</strong> If Anviz or your webhook sender does not support custom
                headers, append the password as a query parameter in their portal setup:{' '}
                <code className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">
                  ?password=YOUR_PASSWORD
                </code>
              </p>
            </div>

            <div className="space-y-1.5 col-span-2 md:col-span-1">
              <Label htmlFor="an-webhook-pass">Shared Secret (Password)</Label>
              <div className="relative">
                <Input
                  id="an-webhook-pass"
                  type={revealWebhookPass ? 'text' : 'password'}
                  value={webhookPassword}
                  onChange={(e) => setWebhookPassword(e.target.value)}
                  disabled={loading}
                  placeholder="Enter webhook verification password"
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setRevealWebhookPass((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {revealWebhookPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {status?.webhookPasswordMasked && webhookPassword === SECRET_SENTINEL && (
                <p className="text-xs text-muted-foreground">
                  Saved: {status.webhookPasswordMasked}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleTestWebhook}
              disabled={loading || testingWebhook || saving}
            >
              {testingWebhook ? 'Testing...' : 'Test Webhook Connection'}
            </Button>
            {webhookTestResult && (
              <span
                className={`flex items-center gap-1.5 text-xs font-medium ${webhookTestResult.ok ? 'text-emerald-600' : 'text-destructive'}`}
              >
                {webhookTestResult.ok ? (
                  <>
                    <Check className="h-4 w-4" />✓ Webhook validation passed locally (in-process
                    check)
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4" />✗ {webhookTestResult.error}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Cloud API Configuration Section */}
        <div className="space-y-4 pb-4">
          <h3 className="text-sm font-semibold text-foreground">
            2. Cloud API Settings (Server to Device)
          </h3>
          <p className="text-xs text-muted-foreground">
            Required for pull-based synchronization. Generated in the Anviz Developer dashboard
            under Developer settings.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 col-span-2 md:col-span-1">
              <Label htmlFor="an-api-region">API Server Region</Label>
              <Select
                value={apiRegion}
                onValueChange={(v) => setApiRegion(v as 'us' | 'ap' | 'eu')}
                disabled={loading}
              >
                <SelectTrigger id="an-api-region">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="us">United States (US)</SelectItem>
                  <SelectItem value="ap">Asia-Pacific (AP)</SelectItem>
                  <SelectItem value="eu">Europe (EU)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Match this with the region of your Anviz CrossChex Cloud account.
              </p>
            </div>
            <div className="hidden md:block col-span-1" />

            <div className="space-y-1.5">
              <Label htmlFor="an-api-key">API Key</Label>
              <Input
                id="an-api-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API Key"
                disabled={loading}
              />
              {status?.apiKeyMasked && apiKey === SECRET_SENTINEL && (
                <p className="text-xs text-muted-foreground">Saved: {status.apiKeyMasked}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="an-api-secret">API Secret</Label>
              <div className="relative">
                <Input
                  id="an-api-secret"
                  type={revealApiSecret ? 'text' : 'password'}
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  disabled={loading}
                  placeholder="Enter API Secret"
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setRevealApiSecret((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {revealApiSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {status?.apiSecretMasked && apiSecret === SECRET_SENTINEL && (
                <p className="text-xs text-muted-foreground">Saved: {status.apiSecretMasked}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleTestApi}
              disabled={loading || testingApi || saving || pollingActive}
            >
              {testingApi ? 'Testing...' : 'Test Cloud API Connection'}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleStartPolling}
              disabled={loading || testingApi || saving || pollingActive}
              className={
                pollingActive
                  ? 'border-emerald-500 text-emerald-500 hover:text-emerald-600 font-medium'
                  : ''
              }
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              {pollingActive ? `Polling API (${pollingTimeLeft}s)` : 'Start 2-Min API Polling Test'}
            </Button>

            {apiTestResult && (
              <span
                className={`flex items-center gap-1.5 text-xs font-medium ${apiTestResult.ok ? 'text-emerald-600' : 'text-destructive'}`}
              >
                {apiTestResult.ok ? (
                  <>
                    <Check className="h-4 w-4" />✓ Successfully authenticated and retrieved token
                    from Anviz Cloud
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4" />✗ {apiTestResult.error}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Global Save Actions */}
        <div className="flex items-center gap-4 pt-4 border-t">
          <Button onClick={handleSave} disabled={loading || saving} size="default">
            {saving ? 'Saving Settings...' : 'Save Configuration'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
