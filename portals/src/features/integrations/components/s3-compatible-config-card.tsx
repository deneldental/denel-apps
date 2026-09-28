import { Cloud, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SECRET_SENTINEL, type StorageTestResult } from '@/lib/actions/integrations'
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
import { StorageUsagePanel } from './storage-usage-panel'

// Shared DTO shape across all S3-compat providers (R2, DO Spaces, future
// AWS S3 / Wasabi / Backblaze). The backend redacts secrets and returns
// masked previews so cleartext never leaves the server.
export interface S3CompatStatus {
  endpoint: string
  bucket: string
  region: string
  publicUrl: string
  privateBucket?: string
  quotaGB: number | null
  hasAccessKey: boolean
  hasSecretKey: boolean
  accessKeyMasked: string | null
  secretKeyMasked: string | null
}

export interface S3CompatWritePayload {
  endpoint: string
  bucket: string
  region: string
  publicUrl: string
  privateBucket?: string
  quotaGB: number | null
  accessKeyId: string
  secretAccessKey: string
}

export interface S3CompatibleConfigCardProps {
  /** Stable id used to scope DOM ids (e.g. `r2`, `do-spaces`). */
  providerId: string
  /** Backend usage-endpoint id; matches the `/:provider/usage` route. */
  usageProviderId: 'r2' | 'do_spaces'
  /** Display label, shown in the card title. */
  label: string
  /** One-line description of the provider. */
  description: string
  endpointPlaceholder?: string
  regionPlaceholder?: string
  publicUrlPlaceholder?: string
  /**
   * R2 only: a second bucket for private files (R2 has no per-object ACL).
   * DO Spaces keeps one bucket and marks private objects with an ACL.
   */
  withPrivateBucket?: boolean
  statusLoader: () => Promise<{
    success: boolean
    data?: S3CompatStatus
    error?: string
  }>
  saver: (payload: S3CompatWritePayload) => Promise<{ success: boolean; error?: string }>
  tester: () => Promise<{
    success: boolean
    data?: StorageTestResult
    error?: string
  }>
}

export function S3CompatibleConfigCard({
  providerId,
  usageProviderId,
  label,
  description,
  endpointPlaceholder,
  regionPlaceholder,
  publicUrlPlaceholder,
  withPrivateBucket = false,
  statusLoader,
  saver,
  tester,
}: S3CompatibleConfigCardProps) {
  const KEY = ['integrations', 's3-compatible', providerId] as const
  const query = useApiQuery(KEY, statusLoader)
  const status = query.data ?? null
  const loading = query.isLoading

  const saveMutation = useApiMutation(saver, { invalidates: [KEY] })

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<StorageTestResult | null>(null)

  const [endpoint, setEndpoint] = useState('')
  const [bucket, setBucket] = useState('')
  const [privateBucket, setPrivateBucket] = useState('')
  const [region, setRegion] = useState(regionPlaceholder ?? '')
  const [publicUrl, setPublicUrl] = useState('')
  const [quotaGB, setQuotaGB] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [revealSecret, setRevealSecret] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: regionPlaceholder is a stable prop, only re-seed when status (re)loads
  useEffect(() => {
    if (!status) return
    setEndpoint(status.endpoint)
    setBucket(status.bucket)
    setPrivateBucket(status.privateBucket ?? '')
    setRegion(status.region || regionPlaceholder || '')
    setPublicUrl(status.publicUrl)
    setQuotaGB(status.quotaGB != null ? String(status.quotaGB) : '')
    setAccessKeyId(status.hasAccessKey ? SECRET_SENTINEL : '')
    setSecretAccessKey(status.hasSecretKey ? SECRET_SENTINEL : '')
  }, [status])

  const handleSave = async () => {
    const trimmedQuota = quotaGB.trim()
    const parsedQuota = trimmedQuota === '' ? null : Number(trimmedQuota)
    try {
      await saveMutation.mutateAsync({
        endpoint,
        bucket,
        ...(withPrivateBucket ? { privateBucket } : {}),
        region,
        publicUrl,
        quotaGB:
          parsedQuota != null && Number.isFinite(parsedQuota) && parsedQuota > 0
            ? parsedQuota
            : null,
        accessKeyId,
        secretAccessKey,
      })
      toast.success(`${label} saved`)
      setTestResult(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const res = await tester()
    setTesting(false)
    if (res.success && res.data) setTestResult(res.data)
    else setTestResult({ ok: false, error: res.error || 'Test failed' })
  }

  const saving = saveMutation.isPending
  const id = (suffix: string) => `${providerId}-${suffix}`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5" />
          {label}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={id('endpoint')}>Endpoint URL</Label>
            <Input
              id={id('endpoint')}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={endpointPlaceholder}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('bucket')}>{withPrivateBucket ? 'Public bucket' : 'Bucket'}</Label>
            <Input
              id={id('bucket')}
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              disabled={loading}
            />
          </div>
          {withPrivateBucket && (
            <div className="space-y-1.5">
              <Label htmlFor={id('private-bucket')}>Private bucket</Label>
              <Input
                id={id('private-bucket')}
                value={privateBucket}
                onChange={(e) => setPrivateBucket(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Everything except branding. Give it no public access.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={id('region')}>Region</Label>
            <Input
              id={id('region')}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder={regionPlaceholder}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('public')}>
              {withPrivateBucket ? 'Public bucket URL' : 'Public URL prefix'}
            </Label>
            <Input
              id={id('public')}
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              placeholder={publicUrlPlaceholder ?? 'optional'}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('quota')}>Plan quota (GB)</Label>
            <Input
              id={id('quota')}
              type="number"
              min={0}
              step="any"
              value={quotaGB}
              onChange={(e) => setQuotaGB(e.target.value)}
              placeholder="e.g. 250 (optional)"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('access')}>Access key ID</Label>
            <Input
              id={id('access')}
              type="password"
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              disabled={loading}
            />
            {status?.accessKeyMasked && accessKeyId === SECRET_SENTINEL && (
              <p className="text-xs text-muted-foreground">Saved: {status.accessKeyMasked}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('secret')}>Secret access key</Label>
            <div className="relative">
              <Input
                id={id('secret')}
                type={revealSecret ? 'text' : 'password'}
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
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
            {status?.secretKeyMasked && secretAccessKey === SECRET_SENTINEL && (
              <p className="text-xs text-muted-foreground">Saved: {status.secretKeyMasked}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={loading || testing || saving}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          {testResult && !testResult.buckets?.length && (
            <span
              className={`text-sm font-medium ${testResult.ok ? 'text-emerald-600' : 'text-destructive'}`}
            >
              {testResult.ok ? '✓ Connected' : `✗ ${testResult.error}`}
            </span>
          )}
        </div>

        {testResult?.buckets && testResult.buckets.length > 0 && (
          <ul className="space-y-1 text-sm">
            {testResult.buckets.map((b) => (
              <li
                key={b.role}
                className={`font-medium ${b.ok ? 'text-emerald-600' : 'text-destructive'}`}
              >
                {b.ok
                  ? `✓ ${b.role === 'public' ? 'Public' : 'Private'} bucket ${b.bucket}`
                  : `✗ ${b.role === 'public' ? 'Public' : 'Private'} bucket ${b.bucket} — ${b.error}`}
              </li>
            ))}
          </ul>
        )}

        <StorageUsagePanel
          providerId={usageProviderId}
          enabled={!loading && !!status?.hasAccessKey && !!status?.hasSecretKey}
        />
      </CardContent>
    </Card>
  )
}
