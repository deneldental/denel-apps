import { format } from 'date-fns'
import { CheckCircle2, Copy, KeyRound, Loader2, Plus, ShieldX, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  type ApiKeyGenerated,
  type ApiKeyRow,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  testApiKey,
} from '@/lib/actions/api-keys'
import { useApiMutation, useApiQuery } from '@/lib/query'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'

type TestState = 'idle' | 'testing' | 'active' | 'inactive' | 'error'

const WEBSITE_BOOKINGS_KEYS_KEY = ['integrations', 'website-bookings-keys'] as const

export function WebsiteBookingsKeysCard() {
  const query = useApiQuery(WEBSITE_BOOKINGS_KEYS_KEY, listApiKeys)
  const keys = query.data ?? []
  const loading = query.isLoading

  const [newLabel, setNewLabel] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [generated, setGenerated] = useState<ApiKeyGenerated | null>(null)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null)

  const createMutation = useApiMutation(
    (label: string) => createApiKey(label, 'website_bookings.create'),
    { invalidates: [WEBSITE_BOOKINGS_KEYS_KEY] }
  )
  const revokeMutation = useApiMutation(revokeApiKey, { invalidates: [WEBSITE_BOOKINGS_KEYS_KEY] })
  const creating = createMutation.isPending
  const revoking = revokeMutation.isPending

  async function handleCreate() {
    const label = newLabel.trim()
    if (!label) {
      toast.error('Label is required')
      return
    }
    try {
      const data = await createMutation.mutateAsync(label)
      setGenerated(data)
      setCreateOpen(false)
      setNewLabel('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create key')
    }
  }

  async function handleTest(id: string) {
    setTestStates((s) => ({ ...s, [id]: 'testing' }))
    try {
      const res = await testApiKey(id)
      if (res.success && res.data) {
        setTestStates((s) => ({ ...s, [id]: res.data?.active ? 'active' : 'inactive' }))
      } else {
        setTestStates((s) => ({ ...s, [id]: 'error' }))
      }
    } catch {
      setTestStates((s) => ({ ...s, [id]: 'error' }))
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    try {
      await revokeMutation.mutateAsync(revokeTarget.id)
      toast.success('Key revoked')
      setRevokeTarget(null)
    } catch {
      toast.error('Failed to revoke')
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Copy failed — select the text manually')
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Website Bookings API Keys
              </CardTitle>
              <CardDescription>
                Keys the marketing website uses to submit booking requests. Each key is shown once
                at creation — store it in the website's environment variables and pass it as the
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">X-Api-Key</code>
                header.
              </CardDescription>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="shrink-0">
              <Plus className="mr-1.5 h-4 w-4" />
              New key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No API keys yet. Click <span className="font-medium">New key</span> to generate one
              for the marketing website.
            </div>
          ) : (
            <div className="divide-y">
              {keys.map((k) => {
                const status = testStates[k.id] ?? 'idle'
                const isRevoked = k.revokedAt !== null
                return (
                  <div
                    key={k.id}
                    className="py-3 flex flex-wrap items-center gap-3 justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm truncate">{k.label}</p>
                        {isRevoked ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-red-200 text-red-700"
                          >
                            Revoked
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-emerald-200 text-emerald-700"
                          >
                            Active
                          </Badge>
                        )}
                        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                          {k.keyPrefix}…
                        </code>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Created {format(new Date(k.createdAt), 'MMM d, yyyy')}
                        {' · '}
                        {k.lastUsedAt
                          ? `last used ${format(new Date(k.lastUsedAt), 'MMM d, h:mm a')}`
                          : 'never used'}
                      </p>
                      {status !== 'idle' && (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium">
                          {status === 'testing' && (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Testing…
                            </>
                          )}
                          {status === 'active' && (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Active &amp; ready
                            </span>
                          )}
                          {status === 'inactive' && (
                            <span className="inline-flex items-center gap-1 text-red-700">
                              <XCircle className="h-3.5 w-3.5" />
                              Revoked — requests will be rejected
                            </span>
                          )}
                          {status === 'error' && (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <XCircle className="h-3.5 w-3.5" />
                              Test failed
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTest(k.id)}
                        disabled={status === 'testing'}
                      >
                        Test
                      </Button>
                      {!isRevoked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRevokeTarget(k)}
                        >
                          <ShieldX className="h-4 w-4" />
                          <span className="sr-only">Revoke</span>
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false)
            setNewLabel('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Give the key a label so you can identify it later (e.g. the website domain or the
              integration name).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="api-key-label">Label</Label>
            <Input
              id="api-key-label"
              autoFocus
              placeholder="deneldental.com"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              disabled={creating}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Create key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generated key reveal — shown ONCE */}
      <Dialog open={generated !== null} onOpenChange={(open) => !open && setGenerated(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Save this key — it won't be shown again</DialogTitle>
            <DialogDescription>
              Copy the key now and store it in the website's environment variables. After you close
              this dialog the secret is gone forever; you'd need to generate a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>API key</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={generated?.plaintext ?? ''}
                className="font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => generated && copyToClipboard(generated.plaintext)}
                aria-label="Copy to clipboard"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Pass it as the <code className="rounded bg-muted px-1">X-Api-Key</code> header on
              every <code className="rounded bg-muted px-1">POST /api/website-bookings</code>{' '}
              request.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setGenerated(null)}>I've saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        onConfirm={handleRevoke}
        isLoading={revoking}
        title="Revoke API key"
        description="The website will be unable to submit bookings until you generate and deploy a new key. This cannot be undone."
        itemName={revokeTarget?.label}
      />
    </>
  )
}
