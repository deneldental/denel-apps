import { formatDistanceToNow } from 'date-fns'
import { Loader2, RefreshCcw, ShieldOff, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  deletePatientSession,
  listPatientSessions,
  type PatientSession,
  revokePatientPwa,
} from '@/lib/actions/access-management'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'
import { Separator } from '@/shared/components/ui/separator'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

/**
 * Per-patient PWA access management — surfaces grant/revoke/sessions on the
 * patient detail page. Previously these flows lived in Access Management; PR-5
 * collapses them onto the patient record where they belong (patients aren't
 * RBAC users, so AM was the wrong neighbourhood).
 */
export function PwaAccessTab({
  patientId,
  patientName,
  pwaEnabled,
  onChanged,
}: {
  patientId: string
  patientName: string
  pwaEnabled: boolean
  onChanged?: () => void
}) {
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')

  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)

  const grantGuard = useSubmitGuard()
  const revokeGuard = useSubmitGuard()
  const revokeSessionsGuard = useSubmitGuard()

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: revokeReason.trim().length > 0,
    onClose: () => {
      setRevokeOpen(false)
      setRevokeReason('')
    },
  })

  // Same key shape access-management/pages/patients.tsx uses for the same
  // patient's sessions — sharing it means killing a session from either
  // screen refreshes the other without a reload.
  const sessionsKey = ['access-management', 'patient-sessions', patientId] as const
  const sessionsQuery = useApiQuery<PatientSession[]>(
    sessionsKey,
    () => listPatientSessions(patientId),
    { enabled: pwaEnabled }
  )
  const sessions = sessionsQuery.data ?? []
  const loading = sessionsQuery.isLoading

  useEffect(() => {
    if (sessionsQuery.isError) {
      toast.error(sessionsQuery.error.message || 'Failed to load sessions')
    }
  }, [sessionsQuery.isError, sessionsQuery.error])

  async function loadSessions() {
    await sessionsQuery.refetch()
  }

  function handleGrantPwa() {
    void grantGuard.submit(async () => {
      const res = await api.post(`/api/patients/${patientId}/enable-pwa`, { enabled: true })
      if (!res.success) {
        surfaceApiError(res, 'Failed to enable PWA access')
        return
      }
      toast.success('App access enabled — SMS sent')
      onChanged?.()
    })
  }

  function handleRevokePwa() {
    void revokeGuard.submit(async () => {
      const res = await revokePatientPwa(patientId, revokeReason.trim() || undefined)
      if (!res.success) {
        surfaceApiError(res, 'Failed to revoke PWA access')
        return
      }
      toast.success(
        `PWA revoked` +
          (res.data?.killedSessions ? ` (${res.data.killedSessions} session(s) killed)` : '')
      )
      setRevokeOpen(false)
      setRevokeReason('')
      onChanged?.()
      await loadSessions()
    })
  }

  // Clears every trusted-device docking on this patient's phone + their active
  // sessions, so the next sign-in (for the whole family on that number) requires
  // a fresh OTP. This is the "lost/changed phone — start fresh" reset.
  function handleForceReverify() {
    void revokeSessionsGuard.submit(async () => {
      const res = await api.post(`/api/patients/${patientId}/reset-pwa-devices`, {})
      if (!res.success) {
        surfaceApiError(res, 'Failed to reset devices')
        return
      }
      toast.success('Devices reset — next sign-in needs a new code')
      await loadSessions()
    })
  }

  async function handleKillSession(sessionId: string) {
    if (deletingSessionId) return
    setDeletingSessionId(sessionId)
    try {
      const res = await deletePatientSession(sessionId)
      if (!res.success) {
        surfaceApiError(res, 'Failed to delete session')
        return
      }
      toast.success('Session deleted')
      await loadSessions()
    } finally {
      setDeletingSessionId(null)
    }
  }

  if (!pwaEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4" />
            Patient PWA access
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This patient does not have app access. Enabling it lets them sign in to the patient app
            with their phone number — we text a one-time code to verify each new device (and every
            30 days). A phone number must be on file. They'll also sign a consent in the app before
            their records load.
          </p>
          <Button onClick={handleGrantPwa} disabled={grantGuard.isSubmitting}>
            {grantGuard.isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enabling…
              </>
            ) : (
              <>
                <Smartphone className="mr-2 h-4 w-4" /> Enable app access
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-emerald-600" />
            Patient PWA access
            <Badge variant="secondary" className="ml-2">
              Active
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {patientName} signs in to the patient app with their phone number (one-time SMS code).
            "Force re-verification" clears trusted devices on that number so the next sign-in needs
            a fresh code. Manage active sessions below.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleForceReverify}
              disabled={revokeSessionsGuard.isSubmitting}
            >
              {revokeSessionsGuard.isSubmitting ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-3.5 w-3.5" />
              )}
              Force re-verification
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setRevokeOpen(true)}>
              <ShieldOff className="mr-2 h-3.5 w-3.5" />
              Revoke PWA access
            </Button>
          </div>

          <Separator />

          <div>
            <p className="text-sm font-medium mb-2">
              Active sessions{' '}
              <span className="text-muted-foreground text-xs">({sessions.length})</span>
            </p>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active sessions.</p>
            ) : (
              <ul className="space-y-2">
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-start justify-between gap-2 rounded-md border p-3 text-xs"
                  >
                    <div className="flex-1 space-y-0.5">
                      <p className="font-medium text-sm">{s.userAgent ?? 'Unknown device'}</p>
                      <p className="text-muted-foreground">{s.ipAddress ?? 'no IP'}</p>
                      <p className="text-muted-foreground">
                        Last used{' '}
                        {s.lastUsedAt
                          ? formatDistanceToNow(new Date(s.lastUsedAt), { addSuffix: true })
                          : 'never'}
                      </p>
                      <p className="text-muted-foreground">
                        Expires{' '}
                        {s.expiresAt
                          ? formatDistanceToNow(new Date(s.expiresAt), { addSuffix: true })
                          : 'unknown'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      onClick={() => handleKillSession(s.id)}
                      disabled={deletingSessionId === s.id}
                      aria-label={`Delete session ${s.id}`}
                    >
                      {deletingSessionId === s.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={revokeOpen} onOpenChange={guardedOnOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldOff className="h-4 w-4 text-destructive" />
              Revoke PWA — {patientName}
            </DialogTitle>
            <DialogDescription>
              Disables this patient's app access and signs them out everywhere. Clinical data is
              untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">Reason (optional)</Label>
            <Textarea
              id="revoke-reason"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="e.g. Patient requested account deletion."
              rows={3}
              maxLength={500}
              disabled={revokeGuard.isSubmitting}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => guardedOnOpenChange(false)}
              disabled={revokeGuard.isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevokePwa}
              disabled={revokeGuard.isSubmitting}
            >
              {revokeGuard.isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Revoking…
                </>
              ) : (
                <>
                  <ShieldOff className="mr-2 h-4 w-4" /> Revoke PWA
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
        description="You have typed a revoke reason. If you leave now, it will be lost."
      />
    </div>
  )
}
