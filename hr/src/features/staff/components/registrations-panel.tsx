import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PasswordInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@denel/ui'
import { CheckCircle2, Clock, Copy, FileText, Link2, Loader2, Trash2, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { roleOptionsFor } from '@/features/staff/__mock__/team-members'
import { approvalAccess, MIN_FIRST_PASSWORD } from '@/features/staff/role-access'
import {
  type ApproveAdminFields,
  approveInvite,
  deleteInvite,
  generateInvite,
  getInvite,
  listInvites,
  type RegistrationInviteDetail,
  type RegistrationInviteSummary,
  rejectInvite,
} from '@/lib/actions/staff-registration'
import { onboardedSignIns } from '@/lib/roles'
import { StatusBadge, type StatusTone } from '@/shared/components/status-badge'
import { useConfirm } from '@/shared/hooks/use-confirm'
import { useCanAssignAnyRole } from '@/shared/hooks/use-role-authority'

// Team app origin — the register form lives there. In prod this is injected;
// locally it defaults to the Team dev server.
const TEAM_BASE =
  (import.meta.env.VITE_PWA_APP_URL as string | undefined) ||
  (import.meta.env.VITE_TEAM_APP_URL as string | undefined) ||
  'http://localhost:5175'

const DEPT_LABELS: Record<string, string> = {
  dental: 'Dental',
  front_desk: 'Front Desk',
  both: 'Both',
}

// The roles offered here come from the shared assignable-role list (see
// TEAM_ROLE_OPTIONS' doc comment) so this and Access Management never drift, narrowed to what
// the reviewer may actually give (D15): administrators get all of them, an HR administrator
// only Staff, Receptionist and Lab Technician. 'doctor' is never offered: a self-registered
// doctor should be approved with 'none' here and then set up from Portal → Specialists, which
// creates the linked specialist record this panel does not.
const NO_ROLE_OPTION = { value: 'none', label: 'Assign later (Access Management)' }

function prettify(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  return String(v)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Generate-link dialog ─────────────────────────────────────────────────────

export function GenerateInviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  // Reset when the dialog closes.
  useEffect(() => {
    if (!open) {
      setNote('')
      setLink(null)
      setExpiresAt(null)
      setBusy(false)
    }
  }, [open])

  async function handleGenerate() {
    setBusy(true)
    const res = await generateInvite(note.trim() || undefined)
    setBusy(false)
    if (res.success && res.data) {
      setLink(`${TEAM_BASE}${res.data.path}`)
      setExpiresAt(res.data.expiresAt)
    } else {
      toast.error(res.error || 'Failed to generate link')
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy — select and copy manually')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate registration link</DialogTitle>
          <DialogDescription>
            A one-time link the new staff opens to fill in their own details. Expires in 24 hours.
          </DialogDescription>
        </DialogHeader>

        {!link ? (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-note">Note (optional)</Label>
              <Input
                id="invite-note"
                placeholder="e.g. New receptionist — Ama"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Only for your reference on the pending list.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2">
              <Input readOnly value={link} className="font-mono text-xs" />
              <Button type="button" size="icon" variant="outline" onClick={copy}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {expiresAt && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Expires {new Date(expiresAt).toLocaleString()}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Send this to the new staff member. They verify their phone, complete the form, and it
              lands in Pending registrations for your approval.
            </p>
          </div>
        )}

        <DialogFooter>
          {!link ? (
            <Button onClick={handleGenerate} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-2 h-4 w-4" />
              )}
              Generate link
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Pending registrations card + review dialog ───────────────────────────────

const STATUS_BADGE: Record<string, { label: string; tone: StatusTone }> = {
  submitted: { label: 'Awaiting review', tone: 'warning' },
  pending: { label: 'Sent — not submitted', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  expired: { label: 'Expired', tone: 'danger' },
}

export function PendingRegistrationsCard({ onApproved }: { onApproved?: () => void }) {
  const [rows, setRows] = useState<RegistrationInviteSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listInvites()
    if (res.success && Array.isArray(res.data)) {
      // Surface the actionable ones first (submitted), hide nothing.
      setRows(res.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Delete invite link',
      description: 'Once deleted, this invite link can no longer be used.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    setDeletingId(id)
    try {
      const res = await deleteInvite(id)
      if (res.success) {
        toast.success('Invite link deleted successfully')
        void load()
      } else {
        toast.error(res.error || 'Failed to delete invite link')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setDeletingId(null)
    }
  }

  const submitted = rows.filter((r) => r.status === 'submitted')
  const others = rows.filter((r) => r.status !== 'submitted')

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5" />
            Pending registrations
            {submitted.length > 0 && (
              <Badge variant="default" className="ml-1">
                {submitted.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>Self-registrations awaiting your review.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No registrations yet. Use “Generate link” to invite a new staff member.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {[...submitted, ...others].map((r) => {
                const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending
                const actionable = r.status === 'submitted'
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {r.fullName || r.note || 'Unnamed invite'}
                        </span>
                        <StatusBadge tone={badge.tone} className="text-[10px] normal-case">
                          {badge.label}
                        </StatusBadge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.title ? `${r.title} · ` : ''}
                        {r.phone || 'no phone yet'}
                        {r.submittedAt
                          ? ` · submitted ${new Date(r.submittedAt).toLocaleDateString()}`
                          : ''}
                      </p>
                    </div>
                    {actionable ? (
                      <Button size="sm" onClick={() => setReviewId(r.id)}>
                        Review
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {r.staffId ? 'Added' : ''}
                        </span>
                        {(r.status === 'pending' ||
                          r.status === 'expired' ||
                          r.status === 'rejected') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-full"
                            onClick={() => handleDelete(r.id)}
                            disabled={deletingId === r.id}
                            aria-label="Delete invite"
                          >
                            {deletingId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <ReviewDialog
        id={reviewId}
        onClose={() => setReviewId(null)}
        onDone={() => {
          setReviewId(null)
          void load()
          onApproved?.()
        }}
      />

      {confirmDialog}
    </>
  )
}

// ── Review dialog ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{prettify(value)}</span>
    </div>
  )
}

function ReviewDialog({
  id,
  onClose,
  onDone,
}: {
  id: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [detail, setDetail] = useState<RegistrationInviteDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  // Admin fields
  const [staffType, setStaffType] = useState<'internal' | 'external'>('internal')
  const [deviceUserId, setDeviceUserId] = useState('')
  const [salaryBand, setSalaryBand] = useState('')
  const [role, setRole] = useState('none')
  const [initialPassword, setInitialPassword] = useState('')
  const canAssignAnyRole = useCanAssignAnyRole()
  const roleOptions = [NO_ROLE_OPTION, ...roleOptionsFor(canAssignAnyRole)]
  const [flags, setFlags] = useState({
    tracksAttendance: true,
    hasPayslip: true,
    requiresLicense: false,
    isClinicalPractitioner: false,
    receivesCommission: false,
  })

  useEffect(() => {
    if (!id) {
      setDetail(null)
      return
    }
    setLoading(true)
    getInvite(id).then((res) => {
      setLoading(false)
      if (res.success && res.data) setDetail(res.data)
      else toast.error(res.error || 'Failed to load registration')
    })
    // Reset admin fields for each open.
    setStaffType('internal')
    setDeviceUserId('')
    setSalaryBand('')
    setRole('none')
    setInitialPassword('')
    setFlags({
      tracksAttendance: true,
      hasPayslip: true,
      requiresLicense: false,
      isClinicalPractitioner: false,
      receivesCommission: false,
    })
    setRejecting(false)
    setRejectReason('')
  }, [id])

  const d = detail?.submittedData ?? {}

  // Portal and HR sign in with an e-mail and a password; the Team app is phone + SMS code. A role
  // that signs in with a password needs the registrant's e-mail and a first password from you
  // (D16) — otherwise they would hold a role they cannot use until an admin reset their password.
  const registrantEmail = typeof d.email === 'string' ? d.email.trim() : ''
  const { needsPassword, passwordTooShort, canApprove, passwordToSend } = approvalAccess({
    role,
    registrantEmail,
    initialPassword,
  })

  async function handleApprove() {
    if (!id) return
    setBusy(true)
    const admin: ApproveAdminFields = {
      staffType,
      deviceUserId: deviceUserId.trim() || undefined,
      salaryBand: salaryBand.trim() || undefined,
      role: role === 'none' ? undefined : role,
      initialPassword: passwordToSend,
      // No `scopes`: the Team app is the default, and every other app
      // follows the role. Per-person exceptions live in Access → Edit access.
      ...flags,
    }
    const res = await approveInvite(id, admin)
    setBusy(false)
    if (res.success) {
      toast.success(res.data?.message || 'Staff account created')
      onDone()
    } else {
      toast.error(res.error || 'Failed to approve')
    }
  }

  async function handleReject() {
    if (!id) return
    setBusy(true)
    const res = await rejectInvite(id, rejectReason.trim() || undefined)
    setBusy(false)
    if (res.success) {
      toast.success('Registration rejected')
      onDone()
    } else {
      toast.error(res.error || 'Failed to reject')
    }
  }

  const paymentSummary =
    d.bankName || d.bankAccountNumber
      ? `${d.bankName ?? ''} · ${d.bankAccountName ?? ''} · ${d.bankAccountNumber ?? ''}`
      : d.momoNumber
        ? `${prettify(d.momoNetwork)} · ${d.momoNumber}`
        : '—'

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review registration</DialogTitle>
          <DialogDescription>
            Confirm the submitted details, set the access fields, then approve to create the
            account.
          </DialogDescription>
        </DialogHeader>

        {loading || !detail ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Submitted (read-only) */}
            <section className="rounded-lg border p-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Personal
              </h4>
              <Row label="Full name" value={d.fullName} />
              <Row label="Date of birth" value={d.dateOfBirth} />
              <Row label="Gender" value={d.gender} />
              <Row label="Nationality" value={d.nationality} />
              <Row label="Marital status" value={d.maritalStatus} />
              <Row label="Ghana Card PIN" value={d.ghanaCardPin} />
              <Row label="Phone (login)" value={detail.verifiedPhone} />
              <Row label="Email" value={d.email} />
              <Row label="Residential address" value={d.residentialAddress} />
              <Row label="Digital address" value={d.digitalAddress} />
              <Row
                label="Next of kin"
                value={`${d.nextOfKinName ?? ''} (${prettify(d.nextOfKinRelationship)}) · ${d.nextOfKinPhone ?? ''}`}
              />
            </section>

            <section className="rounded-lg border p-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Employment
              </h4>
              <Row label="Title" value={d.title} />
              <Row label="Department" value={DEPT_LABELS[String(d.department)] ?? d.department} />
              <Row label="Date of joining" value={d.dateOfJoining} />
              <Row label="SSNIT number" value={d.ssnitId} />
              <Row label="Payment" value={paymentSummary} />
            </section>

            <section className="rounded-lg border p-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Education & Emergency
              </h4>
              <Row label="Qualification" value={d.highestQualification} />
              <Row label="Institution" value={d.institution} />
              <Row label="Year" value={d.qualificationYear} />
              <Row
                label="Emergency contact"
                value={`${d.emergencyContactName ?? ''} (${prettify(d.emergencyContactRelationship)}) · ${d.emergencyContactPhone ?? ''}`}
              />
              {detail.cvUrl && (
                <div className="pt-2">
                  <a
                    href={detail.cvUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary underline"
                  >
                    <FileText className="h-4 w-4" />
                    View uploaded CV
                  </a>
                </div>
              )}
            </section>

            {/* Admin-only access fields */}
            <section className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">
                Access (admin only)
              </h4>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Staff type</Label>
                  <Select value={staffType} onValueChange={(v) => setStaffType(v as never)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="internal">Internal</SelectItem>
                      <SelectItem value="external">External</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rv-device">Attendance device ID</Label>
                  <Input
                    id="rv-device"
                    placeholder="Optional"
                    value={deviceUserId}
                    onChange={(e) => setDeviceUserId(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>System role</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Decides what they can do and where they can sign in. “Assign later” = limited
                    Team-app tabs until you set a role in Access Management.
                  </p>
                </div>
                {needsPassword && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="rv-first-password">First password</Label>
                    <PasswordInput
                      id="rv-first-password"
                      autoComplete="new-password"
                      value={initialPassword}
                      onChange={(e) => setInitialPassword(e.target.value)}
                      maxLength={128}
                    />
                    {!registrantEmail ? (
                      <p className="text-[11px] text-destructive">
                        This person gave no e-mail address, and the portal and HR app sign in with
                        one. Choose a Team-app-only role or ask them to register again.
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        They sign in with {registrantEmail} and this password, at least{' '}
                        {MIN_FIRST_PASSWORD} characters, and are asked to choose their own at first
                        sign-in. Share it privately.
                      </p>
                    )}
                    {initialPassword.length > 0 && passwordTooShort && (
                      <p className="text-[11px] text-destructive">
                        At least {MIN_FIRST_PASSWORD} characters.
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="rv-band">Salary band</Label>
                  <Input
                    id="rv-band"
                    placeholder="Optional, e.g. Band A"
                    value={salaryBand}
                    onChange={(e) => setSalaryBand(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Capabilities</Label>
                {(
                  [
                    ['tracksAttendance', 'Tracks attendance'],
                    ['hasPayslip', 'Has payslip'],
                    ['requiresLicense', 'Requires licence'],
                    ['isClinicalPractitioner', 'Clinical practitioner'],
                    ['receivesCommission', 'Receives commission'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm">{label}</span>
                    <Switch
                      checked={flags[key]}
                      onCheckedChange={(v) => setFlags((f) => ({ ...f, [key]: v }))}
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Signs in to</Label>
                <p className="text-sm">
                  {onboardedSignIns(role === 'none' ? null : role).join(' · ')}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Follows the system role. For a one-off exception, use Access → Edit access on
                  their profile after approving.
                </p>
              </div>
            </section>

            {rejecting && (
              <div className="space-y-1.5">
                <Label htmlFor="rv-reject">Reason for rejection (optional)</Label>
                <Textarea
                  id="rv-reject"
                  rows={2}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {detail && (
          <DialogFooter className="gap-2 sm:justify-between">
            {!rejecting ? (
              <>
                <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
                  Reject
                </Button>
                <Button onClick={handleApprove} disabled={busy || !canApprove}>
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Approve & create account
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setRejecting(false)} disabled={busy}>
                  Back
                </Button>
                <Button variant="destructive" onClick={handleReject} disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm reject
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
