import { CheckCircle2, Loader2, Share2, Trash2, UserPlus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type CalendarShare,
  listCalendarShares,
  revokeCalendarShare,
  type ShareResult,
  shareCalendarWith,
} from '@/lib/actions/google-calendar'
import { api } from '@/lib/api-client'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
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

// Auto-share the shared clinic calendar with each doctor (via Google's ACL
// API on the service account). Doctor gets an email saying "calendar X has
// been shared with you", clicks Add, calendar appears in their Google
// Calendar list alongside their own — every booking visible.
//
// This is the no-DWD substitute for attendee invites: same outcome (doctor
// sees their schedule in Google Calendar) without needing Workspace.

type DoctorRow = {
  id: string
  specialistType?: 'internal' | 'external'
  user?: { id: string | null; name?: string; email?: string | null } | null
}

interface Props {
  /** Hide the card entirely when SA isn't the active auth method. */
  visible: boolean
}

const CALENDAR_SHARES_KEY = ['integrations', 'google-calendar', 'shares'] as const

export function CalendarSharesCard({ visible }: Props) {
  const sharesQuery = useApiQuery(CALENDAR_SHARES_KEY, listCalendarShares, { enabled: visible })
  const doctorsQuery = useApiQuery(
    queryKeys.doctors.list(),
    () => api.get<DoctorRow[]>('/api/doctors'),
    { enabled: visible }
  )
  const shares = sharesQuery.data ?? []
  const doctors = doctorsQuery.data ?? []
  const loading = sharesQuery.isLoading || doctorsQuery.isLoading
  const forbidden =
    sharesQuery.error instanceof Error && /forbidden/i.test(sharesQuery.error.message)

  const [adhocEmail, setAdhocEmail] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<CalendarShare | null>(null)

  const shareMutation = useApiMutation((emails: string[]) => shareCalendarWith(emails, 'reader'), {
    invalidates: [CALENDAR_SHARES_KEY],
  })
  const revokeMutation = useApiMutation((ruleId: string) => revokeCalendarShare(ruleId), {
    invalidates: [CALENDAR_SHARES_KEY],
  })
  const sharing = shareMutation.isPending
  const revoking = revokeMutation.isPending

  const sharedEmails = useMemo(() => new Set(shares.map((s) => s.email.toLowerCase())), [shares])

  // Doctors we can share with: must have an email. Internal specialists with a
  // linked user are first-class; external specialists with a contact email are
  // also fine (they'll just get a public-share invite).
  const shareableDoctors = useMemo(
    () => doctors.filter((d) => d.user?.email && !sharedEmails.has(d.user.email.toLowerCase())),
    [doctors, sharedEmails]
  )

  async function doShare(emails: string[]) {
    try {
      const results: ShareResult[] = await shareMutation.mutateAsync(emails)
      const ok = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok)
      if (ok > 0) toast.success(`Shared with ${ok} ${ok === 1 ? 'doctor' : 'doctors'}`)
      // Show each failure with Google's actual reason so the admin knows why.
      for (const f of failed) {
        toast.error(`${f.email}: ${f.error ?? 'unknown error'}`, { duration: 10_000 })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Share failed')
    }
  }

  async function handleShareAll() {
    const emails = shareableDoctors
      .map((d) => d.user?.email)
      .filter((email): email is string => Boolean(email))
    if (emails.length === 0) {
      toast.info('All doctors with an email on file are already shared.')
      return
    }
    await doShare(emails)
  }

  async function handleShareAdhoc() {
    const email = adhocEmail.trim().toLowerCase()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Invalid email')
      return
    }
    if (sharedEmails.has(email)) {
      toast.info('Already shared with that address.')
      return
    }
    await doShare([email])
    setAdhocEmail('')
  }

  async function confirmRevoke() {
    if (!revokeTarget) return
    try {
      await revokeMutation.mutateAsync(revokeTarget.ruleId)
      toast.success(`Removed ${revokeTarget.email}`)
      setRevokeTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke')
    }
  }

  if (!visible || forbidden) return null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share calendar with doctors
          </CardTitle>
          <CardDescription>
            Service-account mode can't auto-invite event attendees without Google Workspace
            Domain-Wide Delegation. Instead, share the shared clinic calendar with each doctor —
            they get an email from Google, click "Add this calendar", and from then on every booking
            appears in their Google Calendar list.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <>
              {/* Currently shared */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Currently shared
                </Label>
                {shares.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No one yet. Use the buttons below to share with doctors.
                  </p>
                ) : (
                  <div className="divide-y rounded-md border">
                    {shares.map((s) => (
                      <div
                        key={s.ruleId}
                        className="flex items-center justify-between gap-2 px-3 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                          <span className="text-sm truncate">{s.email}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {s.role}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRevokeTarget(s)}
                          aria-label="Remove share"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bulk share — all doctors on file with an email */}
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Share with all doctors</p>
                    <p className="text-xs text-muted-foreground">
                      {shareableDoctors.length === 0
                        ? 'All doctors with an email on file are already shared.'
                        : `${shareableDoctors.length} doctor${
                            shareableDoctors.length === 1 ? '' : 's'
                          } with an email not yet shared.`}
                    </p>
                  </div>
                  <Button
                    onClick={handleShareAll}
                    disabled={shareableDoctors.length === 0 || sharing}
                  >
                    {sharing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Users className="mr-2 h-4 w-4" />
                    )}
                    Share with {shareableDoctors.length || 'all'}
                  </Button>
                </div>
                {shareableDoctors.length > 0 && (
                  <details className="text-xs text-muted-foreground mt-2">
                    <summary className="cursor-pointer hover:text-foreground">Show emails</summary>
                    <ul className="mt-2 ml-4 list-disc space-y-0.5">
                      {shareableDoctors.map((d) => (
                        <li key={d.id} className="font-mono text-[11px]">
                          {d.user?.email}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              {/* Ad-hoc share by email */}
              <div className="space-y-2">
                <Label
                  htmlFor="adhoc-share"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Share with another email
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="adhoc-share"
                    type="email"
                    placeholder="someone@example.com"
                    value={adhocEmail}
                    onChange={(e) => setAdhocEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleShareAdhoc()
                      }
                    }}
                  />
                  <Button onClick={handleShareAdhoc} disabled={!adhocEmail.trim() || sharing}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Share
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <DeleteConfirmationDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        onConfirm={confirmRevoke}
        isLoading={revoking}
        title="Remove calendar share?"
        description="The user will lose access to the shared clinic calendar. They can be re-added at any time."
        itemName={revokeTarget?.email}
      />
    </>
  )
}
