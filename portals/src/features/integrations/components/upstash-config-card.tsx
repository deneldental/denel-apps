import { Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  getUpstashStatus,
  SECRET_SENTINEL,
  saveUpstash,
  testUpstash,
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

const UPSTASH_KEY = ['integrations', 'upstash'] as const

export function UpstashConfigCard() {
  const query = useApiQuery(UPSTASH_KEY, getUpstashStatus)
  const status = query.data ?? null
  const loading = query.isLoading

  const saveMutation = useApiMutation(saveUpstash, { invalidates: [UPSTASH_KEY] })

  const [testing, setTesting] = useState(false)

  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  const [qstashBaseUrl, setQstashBaseUrl] = useState('')
  const [qstashToken, setQstashToken] = useState('')
  const [qstashCurrent, setQstashCurrent] = useState('')
  const [qstashNext, setQstashNext] = useState('')
  const [redisRestUrl, setRedisRestUrl] = useState('')
  const [redisRestToken, setRedisRestToken] = useState('')

  useEffect(() => {
    if (!status) return
    setPublicBaseUrl(status.publicBaseUrl)
    setQstashBaseUrl(status.qstashBaseUrl ?? '')
    setRedisRestUrl(status.redisRestUrl)
    setQstashToken(status.hasQstashToken ? SECRET_SENTINEL : '')
    setQstashCurrent(status.hasQstashCurrentSigningKey ? SECRET_SENTINEL : '')
    setQstashNext(status.hasQstashNextSigningKey ? SECRET_SENTINEL : '')
    setRedisRestToken(status.hasRedisRestToken ? SECRET_SENTINEL : '')
  }, [status])

  async function handleSave() {
    if (!publicBaseUrl.trim()) {
      toast.error('Public base URL is required so QStash knows where to hit')
      return
    }
    try {
      const data = await saveMutation.mutateAsync({
        publicBaseUrl: publicBaseUrl.trim(),
        qstashBaseUrl: qstashBaseUrl.trim(),
        qstashToken,
        qstashCurrentSigningKey: qstashCurrent,
        qstashNextSigningKey: qstashNext,
        redisRestUrl: redisRestUrl.trim(),
        redisRestToken,
      })
      if (data?.reloadWarning) {
        toast.warning(`Saved, but cron engine reload failed: ${data.reloadWarning}`)
      } else {
        toast.success('Upstash saved — cron engine reloaded')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  async function handleTest() {
    setTesting(true)
    const res = await testUpstash()
    setTesting(false)
    if (!res.success) {
      toast.error(res.error || 'Test failed')
      return
    }
    const { qstash, redis } = res.data ?? {
      qstash: { ok: false, error: 'No response' },
      redis: { ok: false, error: 'No response' },
    }
    if (qstash.ok && redis.ok) {
      toast.success('QStash ✓  Redis ✓  — both connections healthy')
    } else {
      const parts = [
        `QStash: ${qstash.ok ? '✓' : `✗ ${qstash.error}`}`,
        `Redis: ${redis.ok ? '✓' : `✗ ${redis.error}`}`,
      ]
      toast.error(parts.join('   '))
    }
  }

  const saving = saveMutation.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Upstash
        </CardTitle>
        <CardDescription>
          QStash schedules cron jobs by POSTing signed webhooks to this backend. Redis provides a
          distributed lock so the same job never fires twice across instances. Leave either side
          blank to disable that piece.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-3">
          <h4 className="text-sm font-semibold">QStash (scheduler)</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qs-url">Public base URL</Label>
              <Input
                id="qs-url"
                value={publicBaseUrl}
                onChange={(e) => setPublicBaseUrl(e.target.value)}
                placeholder="https://api.deneldental.com"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Where QStash POSTs cron triggers. Must be reachable from QStash — your prod backend
                in prod, an ngrok/loca.lt tunnel in dev.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qs-base">QStash REST URL (optional)</Label>
              <Input
                id="qs-base"
                value={qstashBaseUrl}
                onChange={(e) => setQstashBaseUrl(e.target.value)}
                placeholder="https://qstash.upstash.io/v2"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank for the prod Upstash API. Set <code>http://127.0.0.1:8080/v2</code> when
                testing against the local <code>qstash-cli dev</code> server.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qs-token">QStash token</Label>
              <Input
                id="qs-token"
                type="password"
                value={qstashToken}
                onChange={(e) => setQstashToken(e.target.value)}
                disabled={loading}
              />
              {status?.qstashTokenMasked && qstashToken === SECRET_SENTINEL && (
                <p className="text-xs text-muted-foreground">Saved: {status.qstashTokenMasked}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qs-curr">Current signing key</Label>
              <Input
                id="qs-curr"
                type="password"
                value={qstashCurrent}
                onChange={(e) => setQstashCurrent(e.target.value)}
                disabled={loading}
              />
              {status?.qstashCurrentSigningKeyMasked && qstashCurrent === SECRET_SENTINEL && (
                <p className="text-xs text-muted-foreground">
                  Saved: {status.qstashCurrentSigningKeyMasked}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qs-next">Next signing key</Label>
              <Input
                id="qs-next"
                type="password"
                value={qstashNext}
                onChange={(e) => setQstashNext(e.target.value)}
                disabled={loading}
              />
              {status?.qstashNextSigningKeyMasked && qstashNext === SECRET_SENTINEL && (
                <p className="text-xs text-muted-foreground">
                  Saved: {status.qstashNextSigningKeyMasked}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t pt-4">
          <h4 className="text-sm font-semibold">Redis (distributed lock)</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="r-url">REST URL</Label>
              <Input
                id="r-url"
                value={redisRestUrl}
                onChange={(e) => setRedisRestUrl(e.target.value)}
                placeholder="https://us1-quiet-bird-12345.upstash.io"
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-token">REST token</Label>
              <Input
                id="r-token"
                type="password"
                value={redisRestToken}
                onChange={(e) => setRedisRestToken(e.target.value)}
                disabled={loading}
              />
              {status?.redisRestTokenMasked && redisRestToken === SECRET_SENTINEL && (
                <p className="text-xs text-muted-foreground">
                  Saved: {status.redisRestTokenMasked}
                </p>
              )}
            </div>
          </div>
        </section>

        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={loading || saving || testing}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={loading || saving || testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Saving reloads the cron engine — no server restart needed.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
