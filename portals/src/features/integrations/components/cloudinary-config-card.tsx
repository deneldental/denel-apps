import { Eye, EyeOff, ImageIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  getCloudinaryStatus,
  SECRET_SENTINEL,
  saveCloudinary,
  testCloudinary,
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
import { Switch } from '@/shared/components/ui/switch'
import { StorageUsagePanel } from './storage-usage-panel'

const CLOUDINARY_KEY = ['integrations', 'cloudinary'] as const

export function CloudinaryConfigCard() {
  const query = useApiQuery(CLOUDINARY_KEY, getCloudinaryStatus)
  const status = query.data ?? null
  const loading = query.isLoading

  const saveMutation = useApiMutation(saveCloudinary, { invalidates: [CLOUDINARY_KEY] })

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const [cloudName, setCloudName] = useState('')
  const [uploadFolder, setUploadFolder] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [revealSecret, setRevealSecret] = useState(false)

  useEffect(() => {
    if (!status) return
    setCloudName(status.cloudName)
    setUploadFolder(status.uploadFolder)
    setEnabled(status.enabled)
    setApiKey(status.hasApiKey ? SECRET_SENTINEL : '')
    setApiSecret(status.hasApiSecret ? SECRET_SENTINEL : '')
  }, [status])

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({ cloudName, uploadFolder, enabled, apiKey, apiSecret })
      toast.success('Cloudinary saved')
      setTestResult(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const res = await testCloudinary()
    setTesting(false)
    if (res.success && res.data) setTestResult(res.data)
    else setTestResult({ ok: false, error: res.error || 'Test failed' })
  }

  const saving = saveMutation.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" />
          Cloudinary
        </CardTitle>
        <CardDescription>
          Image and video CDN with on-the-fly transformations. Configure here and toggle the enabled
          switch to route uploads through Cloudinary instead of object storage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cl-cloud">Cloud name</Label>
            <Input
              id="cl-cloud"
              value={cloudName}
              onChange={(e) => setCloudName(e.target.value)}
              placeholder="my-clinic"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-folder">Upload folder (optional)</Label>
            <Input
              id="cl-folder"
              value={uploadFolder}
              onChange={(e) => setUploadFolder(e.target.value)}
              placeholder="framada-prod"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-key">API key</Label>
            <Input
              id="cl-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={loading}
            />
            {status?.apiKeyMasked && apiKey === SECRET_SENTINEL && (
              <p className="text-xs text-muted-foreground">Saved: {status.apiKeyMasked}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-secret">API secret</Label>
            <div className="relative">
              <Input
                id="cl-secret"
                type={revealSecret ? 'text' : 'password'}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
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
            {status?.apiSecretMasked && apiSecret === SECRET_SENTINEL && (
              <p className="text-xs text-muted-foreground">Saved: {status.apiSecretMasked}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="cl-enabled" className="text-sm font-medium">
              Route uploads through Cloudinary
            </Label>
            <p className="text-xs text-muted-foreground">
              When enabled, file uploads are sent to Cloudinary instead of the configured S3 bucket.
            </p>
          </div>
          <Switch
            id="cl-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={loading}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={loading || testing || saving}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          {testResult && (
            <span
              className={`text-sm font-medium ${testResult.ok ? 'text-emerald-600' : 'text-destructive'}`}
            >
              {testResult.ok ? '✓ Connected' : `✗ ${testResult.error}`}
            </span>
          )}
        </div>

        <StorageUsagePanel
          providerId="cloudinary"
          enabled={!loading && !!status?.hasApiKey && !!status?.hasApiSecret}
        />
      </CardContent>
    </Card>
  )
}
