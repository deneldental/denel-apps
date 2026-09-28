import { AlertCircle, Eye, EyeOff, KeyRound, Loader2, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  clearGoogleOAuthConfig,
  type GoogleOAuthConfigStatus,
  getGoogleOAuthConfig,
  saveGoogleOAuthConfig,
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

const SOURCE_LABEL: Record<GoogleOAuthConfigStatus['source'], string> = {
  db: 'Stored in clinic settings',
  env: 'Inherited from server env vars',
  none: 'Not configured',
}

const SOURCE_TONE: Record<GoogleOAuthConfigStatus['source'], string> = {
  db: 'border-emerald-300 text-emerald-700',
  env: 'border-slate-300 text-slate-700',
  none: 'border-amber-300 text-amber-700',
}

interface Props {
  onSaved?: () => void
  /** When false, render dimmed with an "inactive" badge. */
  isActive?: boolean
}

const GOOGLE_OAUTH_CONFIG_KEY = ['integrations', 'google-calendar', 'oauth-config'] as const

export function GoogleOAuthCredentialsCard({ onSaved, isActive = true }: Props) {
  const query = useApiQuery(GOOGLE_OAUTH_CONFIG_KEY, getGoogleOAuthConfig)
  const status: GoogleOAuthConfigStatus | null = query.data ?? null
  const loading = query.isLoading
  const forbidden = query.error instanceof Error && /forbidden/i.test(query.error.message)

  const saveMutation = useApiMutation(saveGoogleOAuthConfig, {
    invalidates: [GOOGLE_OAUTH_CONFIG_KEY],
  })
  const clearMutation = useApiMutation(clearGoogleOAuthConfig, {
    invalidates: [GOOGLE_OAUTH_CONFIG_KEY],
  })

  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const [clientId, setClientId] = useState('')
  const [redirectUri, setRedirectUri] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)

  useEffect(() => {
    if (!status) return
    setClientId(status.clientId ?? '')
    setRedirectUri(status.redirectUri ?? '')
    setClientSecret('')
  }, [status])

  async function handleSave() {
    if (!clientId.trim()) {
      toast.error('Client ID is required')
      return
    }
    if (!redirectUri.trim()) {
      toast.error('Redirect URI is required')
      return
    }
    if (!status?.hasClientSecret && !clientSecret.trim()) {
      toast.error('Client Secret is required on first save')
      return
    }
    try {
      await saveMutation.mutateAsync({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || null,
        redirectUri: redirectUri.trim(),
      })
      toast.success('Google OAuth config saved')
      setClientSecret('')
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  async function handleClear() {
    try {
      await clearMutation.mutateAsync()
      setShowClearConfirm(false)
      toast.success('Cleared — will fall back to env vars if set')
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
            <KeyRound className="h-5 w-5" />
            OAuth Credentials
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
              <KeyRound className="h-5 w-5" />
              OAuth Credentials
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
              From your{' '}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Google Cloud Console
              </a>
              {' · '}OAuth 2.0 Client ID (Web application).
            </CardDescription>
          </div>
          {status && (
            <Badge variant="outline" className={`text-[10px] ${SOURCE_TONE[status.source]}`}>
              {SOURCE_LABEL[status.source]}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.source === 'env' && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Inherited from environment</AlertTitle>
            <AlertDescription>
              These values came from{' '}
              <code className="text-xs">GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI</code> on the
              server. Saving below will override them with values stored in the clinic database.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="client-id">Client ID</Label>
          <Input
            id="client-id"
            placeholder="123456789-abc…apps.googleusercontent.com"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="client-secret">
            Client Secret
            {status?.hasClientSecret && (
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                Already saved — leave blank to keep current
              </span>
            )}
          </Label>
          <div className="relative">
            <Input
              id="client-secret"
              type={showSecret ? 'text' : 'password'}
              placeholder={status?.hasClientSecret ? '••••••••' : 'GOCSPX-…'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={saving}
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
              onClick={() => setShowSecret((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Stored encrypted (AES-256-GCM). Never returned to the browser after save.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="redirect-uri">Redirect URI</Label>
          <Input
            id="redirect-uri"
            type="url"
            placeholder="https://api.deneldental.com/api/google-calendar/callback"
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            disabled={saving}
          />
          <p className="text-[11px] text-muted-foreground">
            Must exactly match an Authorised redirect URI in your Google OAuth client.
          </p>
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
          {status?.source === 'db' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              disabled={clearing}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Clear & use env fallback
            </Button>
          )}
        </div>
      </CardContent>

      <DeleteConfirmationDialog
        open={showClearConfirm}
        onOpenChange={(open) => !open && setShowClearConfirm(false)}
        onConfirm={handleClear}
        isLoading={clearing}
        title="Clear OAuth config?"
        description="The DB-backed credentials will be removed. The integration will fall back to GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI env vars if those are set, otherwise it will stop working."
      />
    </Card>
  )
}
