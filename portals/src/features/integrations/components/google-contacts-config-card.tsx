import { format } from 'date-fns'
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Unlink,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  disconnectGoogleContacts,
  type GoogleContactsStatus,
  getConnectUrl,
  getGoogleContactsStatus,
  syncGoogleContacts,
} from '@/lib/actions/google-contacts'
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
import { Skeleton } from '@/shared/components/ui/skeleton'

// Friendly labels for the OAuth callback error codes the backend may return
// via ?error=... in the redirect.
const ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    'Google OAuth is not configured. An admin needs to set the credentials in Integrations → Google Calendar (the same credentials power Contacts).',
  missing_code_or_state: 'Google did not return the expected response. Try connecting again.',
  expired: 'The connection request expired. Please try again.',
  'bad signature': 'The connection request was tampered with. Please try again.',
  no_refresh_token:
    'Google did not return a refresh token. This usually means your Google account has already authorized this app — go to https://myaccount.google.com/permissions, remove "Framada", and try again.',
  token_exchange_failed: 'Failed to complete the Google handshake. Check the backend logs.',
  access_denied: 'You declined access. Connect again if this was a mistake.',
}

// This card is remounted via a `key` bump on the parent page whenever a
// sibling credential card saves, so it must always hit the network on mount
// rather than silently reusing a (possibly stale) cached status.
const GOOGLE_CONTACTS_STATUS_KEY = ['integrations', 'google-contacts', 'status'] as const

export function GoogleContactsConfigCard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = useApiQuery(GOOGLE_CONTACTS_STATUS_KEY, getGoogleContactsStatus, {
    refetchOnMount: 'always',
  })
  const status: GoogleContactsStatus | null = query.data ?? null
  const loading = query.isLoading
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const disconnectMutation = useApiMutation(disconnectGoogleContacts, {
    invalidates: [GOOGLE_CONTACTS_STATUS_KEY],
  })
  const disconnecting = disconnectMutation.isPending

  const syncMutation = useApiMutation(syncGoogleContacts)
  const syncing = syncMutation.isPending

  // Surface OAuth callback feedback from the URL once, then strip it.
  useEffect(() => {
    if (searchParams.get('connected') === '1') {
      toast.success('Google Contacts connected')
      const next = new URLSearchParams(searchParams)
      next.delete('connected')
      setSearchParams(next, { replace: true })
    }
    const errorCode = searchParams.get('error')
    if (errorCode) {
      toast.error(ERROR_MESSAGES[errorCode] ?? `Connection failed: ${errorCode}`)
      const next = new URLSearchParams(searchParams)
      next.delete('error')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  function handleConnect() {
    // Full-page redirect — Google's consent screen lives off-origin and the
    // browser must follow the backend's 302 itself.
    window.location.href = getConnectUrl()
  }

  async function handleSync() {
    try {
      const { created, updated, skipped, failed } = await syncMutation.mutateAsync()
      toast.success(
        `Sync complete — ${created} created, ${updated} updated, ${skipped} skipped${
          failed > 0 ? `, ${failed} failed` : ''
        }`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    }
  }

  async function confirmDisconnect() {
    try {
      await disconnectMutation.mutateAsync()
      toast.success('Google Contacts disconnected')
      setDisconnectOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect')
      throw err
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Google Contacts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>
    )
  }

  if (!status?.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Google Contacts
          </CardTitle>
          <CardDescription>Sync patient contacts to your Google account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Not configured</AlertTitle>
            <AlertDescription>
              The Google OAuth client isn't set up yet. An admin needs to fill in the credentials in
              the <strong>OAuth Credentials</strong> card under{' '}
              <strong>Integrations → Google Calendar</strong> (the same Google Cloud project powers
              Contacts).
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Google Contacts
        </CardTitle>
        <CardDescription>
          Connect your Google account to push patient contacts into Google Contacts. You can
          disconnect at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.connected ? (
          <>
            <div className="flex items-start gap-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 p-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Connected as {status.email}</p>
                <p className="text-xs text-muted-foreground">
                  Patient contacts sync to your Google account
                  {status.connectedAt &&
                    ` · since ${format(new Date(status.connectedAt), 'MMM d, yyyy')}`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    Outbound sync only
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    Scope: contacts
                  </Badge>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Inbound sync (Google → Denel Dental) is on the roadmap. For now, edits made directly
              in Google Contacts don't propagate back into Denel Dental.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleSync} disabled={syncing}>
                {syncing ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                )}
                Sync now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDisconnectOpen(true)}
                disabled={disconnecting || syncing}
                className="text-destructive hover:text-destructive"
              >
                {disconnecting ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Unlink className="mr-2 h-3.5 w-3.5" />
                )}
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Not connected</AlertTitle>
              <AlertDescription>
                Click below to authorize Denel Dental to write contacts to your Google account.
                You'll be taken to Google's consent screen and returned here when done.
              </AlertDescription>
            </Alert>
            <Button onClick={handleConnect}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Connect Google Contacts
            </Button>
          </>
        )}
      </CardContent>

      <DeleteConfirmationDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        onConfirm={confirmDisconnect}
        title="Disconnect Google Contacts?"
        description="Existing contacts on Google stay where they are. Patient contacts will stop syncing until you reconnect."
        tone="default"
        confirmLabel="Disconnect"
        isLoading={disconnecting}
      />
    </Card>
  )
}
