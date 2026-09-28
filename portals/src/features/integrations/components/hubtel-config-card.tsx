import { Eye, EyeOff, MessageSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  getHubtelStatus,
  type HubtelTestResult,
  SECRET_SENTINEL,
  saveHubtel,
  testHubtel,
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

const HUBTEL_KEY = ['integrations', 'hubtel'] as const

export function HubtelConfigCard() {
  const query = useApiQuery(HUBTEL_KEY, getHubtelStatus)
  const status = query.data ?? null
  const loading = query.isLoading

  const saveMutation = useApiMutation(saveHubtel, { invalidates: [HUBTEL_KEY] })

  const [testing, setTesting] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [testResult, setTestResult] = useState<HubtelTestResult | null>(null)

  const [senderId, setSenderId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [revealSecret, setRevealSecret] = useState(false)

  useEffect(() => {
    if (!status) return
    setSenderId(status.senderId)
    setClientId(status.hasClientId ? SECRET_SENTINEL : '')
    setClientSecret(status.hasClientSecret ? SECRET_SENTINEL : '')
  }, [status])

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({ senderId, clientId, clientSecret })
      toast.success('Hubtel saved — overrides env on next SMS send')
      setTestResult(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const res = await testHubtel(testPhone.trim())
    setTesting(false)
    if (res.success && res.data) setTestResult(res.data)
    else setTestResult({ ok: false, error: res.error || 'Test failed' })
  }

  const saving = saveMutation.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Hubtel SMS
        </CardTitle>
        <CardDescription>
          SMS gateway credentials. When saved, these override the env-var configuration on every
          outbound SMS. The Sender ID becomes the default <code>From</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="hubtel-sender">Sender ID</Label>
            <Input
              id="hubtel-sender"
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              placeholder="Denel"
              maxLength={11}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">Max 11 chars. Shown to recipients.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hubtel-cid">Client ID</Label>
            <Input
              id="hubtel-cid"
              type="password"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={loading}
            />
            {status?.clientIdMasked && clientId === SECRET_SENTINEL && (
              <p className="text-xs text-muted-foreground">Saved: {status.clientIdMasked}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hubtel-cs">Client Secret</Label>
            <div className="relative">
              <Input
                id="hubtel-cs"
                type={revealSecret ? 'text' : 'password'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                disabled={loading}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setRevealSecret((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={revealSecret ? 'Hide' : 'Reveal typed value'}
              >
                {revealSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {status?.clientSecretMasked && clientSecret === SECRET_SENTINEL && (
              <p className="text-xs text-muted-foreground">Saved: {status.clientSecretMasked}</p>
            )}
          </div>
        </div>

        <Button onClick={handleSave} disabled={loading || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>

        <div className="space-y-1.5 border-t pt-4">
          <Label htmlFor="hubtel-test-phone">Send a test SMS to</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="hubtel-test-phone"
              type="tel"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="024 000 0000"
              className="w-48"
              disabled={loading}
            />
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={loading || testing || saving || !testPhone.trim()}
            >
              {testing ? 'Sending…' : 'Send test SMS'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Sends one real message with the saved keys and Sender ID, using one SMS credit.
          </p>
          {testResult && <TestResultLine result={testResult} />}
        </div>
      </CardContent>
    </Card>
  )
}

function TestResultLine({ result }: { result: HubtelTestResult }) {
  if (!result.ok) {
    return <p className="text-sm font-medium text-destructive">✗ {result.error}</p>
  }
  if (result.simulated) {
    return (
      <p className="text-sm text-muted-foreground">
        Not sent (local development): {result.reason}. The message was printed in the backend
        console instead.
      </p>
    )
  }
  return <p className="text-sm font-medium text-emerald-600">✓ Test SMS sent — check the phone.</p>
}
