import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import {
  CalendarOff,
  Check,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Inbox,
  Lightbulb,
  Loader2,
  Paperclip,
  Plus,
  UserCheck,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileLeaveSheet } from '@/features/staff/components/file-leave-sheet'
import { LeaveDefaultsSection } from '@/features/staff/components/leave-defaults-section'
import { RequestTypesSection } from '@/features/staff/components/request-types-section'
import { api } from '@/lib/api-client'
import { ACTIONS, MODULES } from '@/lib/modules'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { EmptyState } from '@/shared/components/empty-state'
import { StatusBadge } from '@/shared/components/status-badge'
import { useConfirm } from '@/shared/hooks/use-confirm'
import { usePermissions } from '@/shared/hooks/use-permissions'

// ── Drill-down UI rule (PR-7) ────────────────────────────────────────────────
//
// Both request types use the SAME interaction pattern:
//   row click → right-side review sheet → Approve / Reject + optional comments
//
// Per the UX audit, mixing inline action buttons (old StaffRequestsSection)
// with sheet review (old ProfileChangesSection) on the same page forced HR to
// learn two patterns. The whole page now uses a single pattern. New review
// flows in HR should follow this canonical example.

// ─── Shared types ───────────────────────────────────────────────────────────

type RequestStatus = 'pending' | 'approved' | 'rejected'

type RequestAttachment = { name?: string; url: string }

interface UnifiedRow {
  id: string
  kind: 'staff' | 'profile_change'
  /** Raw request type (staff requests only) — used to split suggestions out. */
  requestType?: string
  staffName: string
  staffCode: string
  subject: string
  details: string
  status: RequestStatus
  submittedAt: string
  reviewComments?: string | null
  /** Files the staff member attached (staff requests only). */
  attachments?: RequestAttachment[]
  /** Field-level diff payload, only present for profile-change requests. */
  diff?: {
    field?: string
    currentValue?: string
    requestedValue?: string
    notes?: string
  }
}

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

// ─── Staff requests (leave / permit / advance / etc.) ──────────────────────

interface ApiStaffRequest {
  id: string
  requestType: string
  subType?: string | null
  reason?: string | null
  description?: string | null
  status: RequestStatus
  submittedAt?: string
  createdAt?: string
  reviewComments?: string | null
  attachments?: RequestAttachment[] | null
  staff?: {
    fullName?: string | null
    staffId?: string | null
  }
}

const TYPE_LABELS: Record<string, string> = {
  leave: 'Leave',
  shift_swap: 'Shift swap',
  training: 'Training',
  permit: 'Permit',
  emergency: 'Emergency',
  official_support: 'Official support',
  suggestion: 'Suggestion',
}

function mapStaffRequest(r: ApiStaffRequest): UnifiedRow {
  const type = r.requestType || 'other'
  const subType = r.subType ? r.subType.replace(/_/g, ' ') : ''
  return {
    id: r.id,
    kind: 'staff',
    requestType: type,
    staffName: r.staff?.fullName || 'Unknown',
    staffCode: r.staff?.staffId || '—',
    subject: `${TYPE_LABELS[type] ?? type}${subType ? ` · ${subType}` : ''}`,
    details: r.reason || r.description || 'No details provided',
    status: r.status,
    submittedAt: formatDate(r.submittedAt || r.createdAt),
    reviewComments: r.reviewComments,
    attachments: Array.isArray(r.attachments)
      ? r.attachments.filter((a): a is RequestAttachment => !!a?.url)
      : [],
  }
}

// ─── Profile-change requests ────────────────────────────────────────────────

interface ApiProfileChange {
  id: string
  staffId: string
  staffName: string | null
  staffCode: string | null
  changeType: string
  requestedData: {
    field?: string
    currentValue?: string
    requestedValue?: string
    notes?: string
  }
  status: RequestStatus
  reviewComments: string | null
  reviewedAt: string | null
  submittedAt: string
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  bank_details: 'Bank details',
  bio: 'Bio',
  contact: 'Contact',
  emergency_contact: 'Emergency contact',
  other: 'Other',
}

function mapProfileChange(r: ApiProfileChange): UnifiedRow {
  return {
    id: r.id,
    kind: 'profile_change',
    staffName: r.staffName ?? 'Unknown',
    staffCode: r.staffCode ?? '—',
    subject: CHANGE_TYPE_LABELS[r.changeType] ?? r.changeType,
    details: r.requestedData.field
      ? `${r.requestedData.field}: ${r.requestedData.requestedValue ?? '—'}`
      : (r.requestedData.notes ?? 'No details provided'),
    status: r.status,
    submittedAt: formatDate(r.submittedAt),
    reviewComments: r.reviewComments,
    diff: r.requestedData,
  }
}

// ─── Review sheet — single component for both request types ─────────────────

function ReviewSheet({
  row,
  onClose,
  onDecision,
}: {
  row: UnifiedRow | null
  onClose: () => void
  onDecision: (
    id: string,
    kind: UnifiedRow['kind'],
    status: 'approved' | 'rejected',
    comments: string
  ) => Promise<void>
}) {
  const [comments, setComments] = useState('')
  const [submitting, setSubmitting] = useState<null | 'approved' | 'rejected'>(null)
  // HR-M10: only show Approve/Reject to users who can act (backend also enforces).
  const { hasPermission } = usePermissions()
  const canReview = hasPermission(MODULES.STAFF_REQUESTS as string, ACTIONS.UPDATE as string)

  // biome-ignore lint/correctness/useExhaustiveDependencies: row?.id is unread, only tracked so this resets when a different request opens
  useEffect(() => {
    setComments('')
    setSubmitting(null)
  }, [row?.id])

  async function decide(status: 'approved' | 'rejected') {
    if (!row) return
    setSubmitting(status)
    try {
      await onDecision(row.id, row.kind, status, comments)
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <Sheet open={!!row} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Review request</SheetTitle>
          <SheetDescription>
            {row?.staffName} · {row?.subject}
          </SheetDescription>
        </SheetHeader>
        {row && (
          <div className="mt-6 space-y-4">
            <div className="rounded-md bg-muted px-4 py-3 text-sm space-y-1.5">
              <p>
                <span className="text-muted-foreground">Submitted:</span> {row.submittedAt}
              </p>
              {row.diff?.field && (
                <p>
                  <span className="text-muted-foreground">Field:</span> {row.diff.field}
                </p>
              )}
              {row.diff?.currentValue !== undefined && (
                <p>
                  <span className="text-muted-foreground">Current:</span> {row.diff.currentValue}
                </p>
              )}
              {row.diff?.requestedValue !== undefined ? (
                <p>
                  <span className="text-muted-foreground">Requested:</span>{' '}
                  <strong>{row.diff.requestedValue}</strong>
                </p>
              ) : (
                <p>
                  <span className="text-muted-foreground">Details:</span> {row.details}
                </p>
              )}
              {row.diff?.notes && (
                <p className="text-muted-foreground italic">"{row.diff.notes}"</p>
              )}
            </div>

            {row.attachments && row.attachments.length > 0 && (
              <div className="space-y-1.5">
                <Label>Attachments</Label>
                <div className="flex flex-col gap-1.5">
                  {row.attachments.map((att, i) => (
                    <a
                      key={att.url}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{att.name || `Attachment ${i + 1}`}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="review-comments">Comments (optional)</Label>
              <Textarea
                id="review-comments"
                placeholder="Add a note for the staff member…"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={3}
              />
            </div>

            {row.status !== 'pending' && (
              <div className="text-xs text-muted-foreground">
                Already <strong>{row.status}</strong>
                {row.reviewComments && <span> — &ldquo;{row.reviewComments}&rdquo;</span>}.
                Approval/rejection is no longer possible.
              </div>
            )}
          </div>
        )}
        <SheetFooter className="mt-6 flex gap-2">
          {row?.status === 'pending' && canReview ? (
            <>
              <Button
                variant="outline"
                className="flex-1 text-destructive border-destructive/40 hover:bg-destructive/5"
                onClick={() => decide('rejected')}
                disabled={!!submitting}
              >
                {submitting === 'rejected' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                Reject
              </Button>
              <Button className="flex-1" onClick={() => decide('approved')} disabled={!!submitting}>
                {submitting === 'approved' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Approve
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose} className="flex-1">
              Close
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ─── Shared columns ─────────────────────────────────────────────────────────

function useRequestColumns(): ColumnDef<UnifiedRow>[] {
  return useMemo<ColumnDef<UnifiedRow>[]>(
    () => [
      {
        accessorKey: 'staffName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Staff" />,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-medium truncate">{row.original.staffName}</p>
            <p className="text-xs text-muted-foreground">{row.original.staffCode}</p>
          </div>
        ),
      },
      {
        accessorKey: 'subject',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Subject" />,
        cell: ({ row }) => <span className="text-sm">{row.original.subject}</span>,
      },
      {
        accessorKey: 'details',
        header: 'Details',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground line-clamp-2 max-w-xs">
            {row.original.details}
          </span>
        ),
      },
      {
        accessorKey: 'submittedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Submitted" />,
        cell: ({ row }) => <span className="text-sm">{row.original.submittedAt}</span>,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    []
  )
}

// ─── Section renderer (table + empty state) ─────────────────────────────────

function RequestSection({
  rows,
  loading,
  emptyTitle,
  emptyDescription,
  onRowClick,
}: {
  rows: UnifiedRow[]
  loading: boolean
  emptyTitle: string
  emptyDescription: string
  onRowClick: (row: UnifiedRow) => void
}) {
  const columns = useRequestColumns()

  if (loading) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }
  if (rows.length === 0) {
    return <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />
  }
  return <DataTable columns={columns} data={rows} meta={{ onRowClick }} />
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function RequestsPage() {
  const [staffRows, setStaffRows] = useState<UnifiedRow[]>([])
  const [profileRows, setProfileRows] = useState<UnifiedRow[]>([])
  const [staffLoading, setStaffLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(true)
  const [reviewTarget, setReviewTarget] = useState<UnifiedRow | null>(null)
  const [fileLeaveOpen, setFileLeaveOpen] = useState(false)
  const [tab, setTab] = useState('time-off')
  const { confirm, confirmDialog } = useConfirm()

  const loadStaffRequests = useCallback(async () => {
    setStaffLoading(true)
    const res = await api.get<ApiStaffRequest[]>('/api/staff/requests/all')
    if (res.success && res.data) {
      setStaffRows(res.data.map(mapStaffRequest))
    } else {
      toast.error(res.error || 'Failed to load requests')
      setStaffRows([])
    }
    setStaffLoading(false)
  }, [])

  const loadProfileChanges = useCallback(async () => {
    setProfileLoading(true)
    const res = await api.get<ApiProfileChange[]>('/api/staff/profile-change-requests')
    if (res.success && res.data) {
      setProfileRows(res.data.map(mapProfileChange))
    } else {
      // PR-26 — was silently setting rows=[] and showing a blank tab. HR
      // had no idea whether the API failed or there was genuinely nothing
      // to review. Mirror the loadStaffRequests pattern.
      toast.error(res.error || 'Failed to load profile-change requests')
      setProfileRows([])
    }
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    void loadStaffRequests()
    void loadProfileChanges()
  }, [loadStaffRequests, loadProfileChanges])

  async function handleDecision(
    id: string,
    kind: UnifiedRow['kind'],
    status: 'approved' | 'rejected',
    comments: string,
    overrideCasual = false
  ) {
    const endpoint =
      kind === 'staff'
        ? `/api/staff/requests/${id}/review`
        : `/api/staff/profile-change-requests/${id}`
    const body: Record<string, unknown> = { status }
    if (comments.trim()) body.reviewComments = comments.trim()
    if (overrideCasual) body.overrideCasual = true
    const res = await api.patch(endpoint, body)
    if (!res.success) {
      // Casual leave over its quota: the backend allows a management override.
      // Offer it rather than dead-ending the approver.
      if (
        kind === 'staff' &&
        status === 'approved' &&
        !overrideCasual &&
        /management override/i.test(res.error ?? '')
      ) {
        const ok = await confirm({
          title: 'Management override',
          description: `${res.error}\n\nApprove anyway with a management override?`,
          confirmLabel: 'Approve anyway',
          tone: 'default',
        })
        if (ok) {
          await handleDecision(id, kind, status, comments, true)
        }
        return
      }
      toast.error(res.error || 'Could not update request')
      return
    }

    toast.success(status === 'approved' ? 'Request approved.' : 'Request rejected.')
    const updater = (rows: UnifiedRow[]) =>
      rows.map((r) =>
        r.id === id ? { ...r, status, reviewComments: comments.trim() || r.reviewComments } : r
      )
    if (kind === 'staff') setStaffRows(updater)
    else setProfileRows(updater)
    setReviewTarget(null)
  }

  // Suggestions are staff requests of type 'suggestion' (filed from the Team
  // app's Suggestion Box) — surfaced on their own tab, out of Time off & permits.
  const timeOffRows = useMemo(
    () => staffRows.filter((r) => r.requestType !== 'suggestion'),
    [staffRows]
  )
  const suggestionRows = useMemo(
    () => staffRows.filter((r) => r.requestType === 'suggestion'),
    [staffRows]
  )
  const staffPending = timeOffRows.filter((r) => r.status === 'pending').length
  const suggestionPending = suggestionRows.filter((r) => r.status === 'pending').length
  const profilePending = profileRows.filter((r) => r.status === 'pending').length

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Requests</h1>
          <p className="text-muted-foreground mt-1">
            Manage leave, permits, advances, and profile change requests in one place.
          </p>
        </div>
        {/* File-request is only for time-off/permits. Profile changes can only be
            initiated by the staff member from the PWA — never filed by HR here. */}
        {tab === 'time-off' && (
          <Button onClick={() => setFileLeaveOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            File request
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="time-off" className="gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Time off &amp; permits
            <Badge variant={staffPending > 0 ? 'default' : 'secondary'}>{staffPending}</Badge>
          </TabsTrigger>
          <TabsTrigger value="profile-changes" className="gap-2">
            <UserCheck className="h-4 w-4" />
            Profile changes
            <Badge variant={profilePending > 0 ? 'default' : 'secondary'}>{profilePending}</Badge>
          </TabsTrigger>
          <TabsTrigger value="suggestions" className="gap-2">
            <Lightbulb className="h-4 w-4" />
            Suggestions
            <Badge variant={suggestionPending > 0 ? 'default' : 'secondary'}>
              {suggestionPending}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="request-types" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Request types
          </TabsTrigger>
          <TabsTrigger value="leave-settings" className="gap-2">
            <CalendarOff className="h-4 w-4" />
            Leave settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="time-off">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Time off &amp; permits
              </CardTitle>
              <CardDescription>
                Leave, shift swaps, training, permits, emergencies, official support. Click a row to
                review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RequestSection
                rows={timeOffRows}
                loading={staffLoading}
                emptyTitle="No requests yet"
                emptyDescription="Staff have not submitted any leave, permit, or training requests."
                onRowClick={(row) => setReviewTarget(row)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profile-changes">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="h-4 w-4" />
                Profile change requests
              </CardTitle>
              <CardDescription>
                Staff requests to update their bio, contact, bank details, or emergency contact.
                Approving applies the change automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RequestSection
                rows={profileRows}
                loading={profileLoading}
                emptyTitle="No profile change requests"
                emptyDescription="Staff have not requested any profile updates."
                onRowClick={(row) => setReviewTarget(row)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suggestions">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="h-4 w-4" />
                Suggestions
              </CardTitle>
              <CardDescription>
                Ideas and feedback submitted from the Team app's Suggestion Box. Click a row to read
                and respond.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RequestSection
                rows={suggestionRows}
                loading={staffLoading}
                emptyTitle="No suggestions yet"
                emptyDescription="Staff have not submitted any suggestions from the Team app."
                onRowClick={(row) => setReviewTarget(row)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="request-types">
          <RequestTypesSection />
        </TabsContent>

        <TabsContent value="leave-settings">
          <LeaveDefaultsSection />
        </TabsContent>
      </Tabs>

      <ReviewSheet
        row={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onDecision={handleDecision}
      />

      <FileLeaveSheet
        open={fileLeaveOpen}
        onOpenChange={setFileLeaveOpen}
        onSubmitted={() => void loadStaffRequests()}
      />

      {confirmDialog}
    </div>
  )
}
