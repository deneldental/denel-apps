import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Label,
  Textarea,
} from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  Eye,
  FileDown,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { MockTeamMember } from '@/features/staff/__mock__/team-members'
import {
  GenerateInviteDialog,
  PendingRegistrationsCard,
} from '@/features/staff/components/registrations-panel'
import {
  type TeamMemberFormPayload,
  TeamMemberSheet,
} from '@/features/staff/components/team-member-sheet'
import { offboardStaff } from '@/lib/actions/access-management'
import { createStaff, deleteStaff, getStaff, updateStaff } from '@/lib/actions/staff'
import { API_BASE_URL, api } from '@/lib/api-client'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { EmptyState } from '@/shared/components/empty-state'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'

/** Fetch a staff member's Employee Data Sheet PDF and trigger a browser download. */
async function downloadStaffDataSheet(id: string, filenameHint?: string) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/staff/${id}/data-sheet`, {
      credentials: 'include',
      headers: { 'X-App-Id': 'hr' },
    })
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `employee-data-sheet-${(filenameHint || id).replace(/[^a-zA-Z0-9_-]/g, '')}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch {
    toast.error('Failed to download data sheet')
  }
}

interface StaffRow extends MockTeamMember {
  /** Real backend UUID — used for navigation and mutations. */
  id: string
  staffCode: string
  deviceUserId: string | null
  position: string | null
  positionTag: 'staff' | 'non_staff'
  isClinicalPractitioner: boolean
  /** Linked auth user. Drives the Delete action: present → offboard
   *  endpoint (role/scope/ban + soft-delete in one tx); null → plain
   *  soft-delete on the staff record. */
  userId: string | null
}

interface ApiStaffRecord {
  id: string
  staffId: string
  userId: string | null
  fullName: string
  email: string | null
  phone: string | null
  role: string | null
  staffType: 'internal' | 'external'
  status: string
  profileImage: string | null
  isExternalTrainer: boolean
  employmentType: string
  deviceUserId: string | null
  createdAt: string
  // PR-14 — projected from the staff row so the list can render position +
  // capability chips without an extra round-trip.
  position?: string | null
  positionTag?: 'staff' | 'non_staff'
  isClinicalPractitioner?: boolean
}

interface TableMeta {
  onEdit: (member: StaffRow) => void
  onView: (member: StaffRow) => void
  onToggleActive: (member: StaffRow) => void
  onDelete: (member: StaffRow) => void
  onRowClick: (member: StaffRow) => void
  [key: string]: unknown
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]?.charAt(0).toUpperCase()
  return (parts[0]?.charAt(0) + parts[parts.length - 1]?.charAt(0)).toUpperCase()
}

function mapRecord(r: ApiStaffRecord): StaffRow {
  return {
    id: r.id,
    staffCode: r.staffId,
    name: r.fullName,
    email: r.email ?? '',
    phone: r.phone ?? '',
    role: r.role ?? null,
    staffType: r.staffType ?? 'internal',
    deviceUserId: r.deviceUserId ?? null,
    avatarUrl: r.profileImage,
    portalAccess: !!r.userId,
    isActive: r.status === 'active',
    createdAt: r.createdAt,
    lastLoginAt: null,
    position: r.position ?? null,
    positionTag: r.positionTag ?? 'staff',
    isClinicalPractitioner: !!r.isClinicalPractitioner,
    userId: r.userId,
  }
}

/**
 * Unified Staff page — single datatable for both internal and external staff,
 * with a Type filter. Rows are clickable: clicking navigates to the detail
 * page. The Add Staff button always renders (the backend gates the actual
 * mutation, so there's no need to gate the UI on the permissions endpoint —
 * which can be flaky when running locally).
 */
export default function StaffPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [members, setMembers] = useState<StaffRow[]>([])
  const [loading, setLoading] = useState(true)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<StaffRow | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  // PR-15 — Delete uses a focused dialog (not AlertDialog) because we need
  // a reason textarea. The dialog only opens when `deleteTarget` is set.
  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Deep-link from the dashboard "New Staff" action: /staff?new=1 opens the
  // add sheet, then strips the param so refresh/back doesn't re-open it.
  useEffect(() => {
    if (searchParams.get('new') !== null) {
      setSheetOpen(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getStaff()
    if (res.success) {
      setMembers((res.data as ApiStaffRecord[]).map(mapRecord))
    } else {
      toast.error(res.error || 'Failed to load staff')
      setMembers([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function handleAdd() {
    setSheetOpen(true)
  }

  /**
   * Edit opens the staff profile, not the wizard.
   *
   * The wizard is create-only: it used to double as an editor but never
   * hydrated the employment or personal fields, so opening it on an existing
   * staffer and saving wiped their birthday and leave entitlement. The
   * profile's per-section sheets (Identity / Personal / Employment / Access /
   * Compensation) edit every field properly.
   */
  const handleEdit = useCallback(
    (member: StaffRow) => {
      navigate(`/staff/${member.id}?tab=profile`)
    },
    [navigate]
  )

  const handleView = useCallback(
    (member: StaffRow) => {
      navigate(`/staff/${member.id}`)
    },
    [navigate]
  )

  const openDelete = useCallback((member: StaffRow) => {
    setDeleteTarget(member)
    setDeleteReason('')
  }, [])

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const target = deleteTarget
    try {
      // If the staff has a linked user, offboard does the right thing —
      // unrole + revoke both scopes + ban + soft-delete the staff record
      // in one transaction. The reason flows to the audit log.
      // Without a linked user, fall back to a plain soft-delete; the
      // reason still surfaces on the audit log entry.
      const res = target.userId
        ? await offboardStaff(target.userId, deleteReason.trim())
        : await deleteStaff(target.id)
      if (!res.success) {
        toast.error(res.error || 'Failed to delete staff member')
        return
      }
      toast.success(`${target.name} deleted.`)
      setDeleteTarget(null)
      setDeleteReason('')
      await load()
    } finally {
      setDeleting(false)
    }
  }

  async function handleConfirmDeactivate() {
    if (!deactivateTarget) return
    const target = deactivateTarget
    setDeactivateTarget(null)
    const nextStatus = target.isActive ? 'inactive' : 'active'
    setSavingId(target.id)
    const res = await updateStaff(target.id, { status: nextStatus } as Record<string, unknown>)
    setSavingId(null)
    if (res.success) {
      setMembers((prev) =>
        prev.map((m) => (m.id === target.id ? { ...m, isActive: nextStatus === 'active' } : m))
      )
      toast.success(target.isActive ? `${target.name} deactivated.` : `${target.name} reactivated.`)
    } else {
      toast.error(res.error || 'Failed to update staff status')
    }
  }

  async function handleSave(payload: TeamMemberFormPayload) {
    // Create only, internal staff only. Editing lives on the staff profile;
    // doctors/specialists have their own onboarding flow.
    if (!payload.initialPassword) {
      toast.error('Initial password is required.')
      return
    }

    const res = await createStaff({
      name: payload.name,
      email: payload.email || undefined,
      phone: payload.phone,
      profileImage: payload.avatarUrl,
      defaultPassword: payload.initialPassword,
      forcePasswordChange: payload.forcePasswordChange,
      // Everyone onboarded here is internal — there is no staff-type switch.
      staffType: 'internal',

      // Biographical. birthDay/birthMonth are derived server-side from
      // dateOfBirth — deliberately not sent, so the two can't disagree.
      dateOfBirth: payload.dateOfBirth,
      gender: payload.gender,
      nationality: payload.nationality,
      maritalStatus: payload.maritalStatus,
      ghanaCardPin: payload.ghanaCardPin,

      // Contact + emergency + next of kin
      residentialAddress: payload.residentialAddress,
      digitalAddress: payload.digitalAddress,
      emergencyContactName: payload.emergencyContactName,
      emergencyContactRelationship: payload.emergencyContactRelationship,
      emergencyContactPhone: payload.emergencyContactPhone,
      nextOfKinName: payload.nextOfKinName,
      nextOfKinRelationship: payload.nextOfKinRelationship,
      nextOfKinPhone: payload.nextOfKinPhone,

      // Employment — position/department/employmentType come from the
      // admin-managed lookups (0178). isExternalTrainer is DERIVED server-side
      // from the type's `kind`, never sent from here.
      position: payload.position,
      department: payload.department,
      employmentType: payload.employmentType,
      dateOfJoining: payload.dateOfJoining,
      probationEndDate: payload.probationEndDate,
      contractEndDate: payload.contractEndDate,
      ssnitId: payload.ssnitId,

      // Payout — bank transfer only.
      bankName: payload.bankName,
      bankAccountName: payload.bankAccountName,
      bankAccountNumber: payload.bankAccountNumber,

      positionTag: payload.positionTag,
      hasPayslip: payload.hasPayslip,
      tracksAttendance: payload.tracksAttendance,
      requiresLicense: payload.requiresLicense,
    } as Record<string, unknown>)
    if (!res.success) {
      toast.error(res.error || 'Failed to create staff')
      return
    }
    const createdUserId = (res.data as { userId?: string | null } | undefined)?.userId ?? null

    // The role is its own endpoint, fired once the record exists. It also
    // decides where they can sign in (role scopes) — no portal switch to set.
    if (payload.initialRole && createdUserId) {
      const roleRes = await api.patch(`/api/access-management/staff/${createdUserId}/role`, {
        role: payload.initialRole,
      })
      if (!roleRes.success) {
        toast.warning(
          `${payload.name} created but role assignment failed — set it in Access Management.`
        )
      }
    }

    toast.success(`${payload.name} added.`)
    setSheetOpen(false)
    await load()
  }

  const meta: TableMeta = useMemo(
    () => ({
      onEdit: handleEdit,
      onView: handleView,
      onToggleActive: (m) => setDeactivateTarget(m),
      onDelete: (m) => openDelete(m),
      onRowClick: (m) => navigate(`/staff/${m.id}`),
    }),
    [openDelete, handleView, navigate, handleEdit]
  )

  const columns = useMemo<ColumnDef<StaffRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => {
          const m = row.original
          return (
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9">
                {m.avatarUrl ? (
                  <AvatarImage src={m.avatarUrl} alt={m.name} />
                ) : (
                  <AvatarFallback>{getInitials(m.name)}</AvatarFallback>
                )}
              </Avatar>
              <div className="min-w-0">
                <p className="font-medium truncate">{m.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {m.staffCode} · {m.email || '—'}
                </p>
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: 'position',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Position" />,
        cell: ({ row }) => {
          const m = row.original
          // PR-14 — position name is the clinic-defined label ("Dental
          // Hygienist", "Clinic Manager"). Capability chips beside it say
          // what the system treats them as (clinical / non-staff).
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">
                {m.position || <span className="italic text-muted-foreground">Not set</span>}
              </span>
              {m.isClinicalPractitioner && (
                <TagBadge className="h-4 px-1 text-[10px]">Clinical</TagBadge>
              )}
              {m.positionTag === 'non_staff' && (
                <TagBadge className="h-4 px-1 text-[10px]">Non-staff</TagBadge>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title="System role" />,
        cell: ({ row }) => {
          const m = row.original
          if (m.role) {
            return (
              <TagBadge label={m.role} className="capitalize">
                {m.role.replace(/_/g, ' ')}
              </TagBadge>
            )
          }
          // PR-6 — limbo state: a staff record with no role can't sign in.
          // Surface as a warning chip that deep-links to the Access tab.
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/staff/${m.id}?tab=profile&step=access`)
              }}
              className="inline-flex items-center gap-1 rounded-md border border-amber-400/60 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300"
            >
              <AlertTriangle className="h-3 w-3" />
              Unassigned
            </button>
          )
        },
      },
      {
        accessorKey: 'phone',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Phone" />,
        cell: ({ row }) => <span className="text-sm">{row.original.phone || '—'}</span>,
      },
      {
        accessorKey: 'isActive',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => {
          const active = row.original.isActive
          return (
            <StatusBadge tone={active ? 'success' : 'danger'}>
              {active ? 'Active' : 'Inactive'}
            </StatusBadge>
          )
        },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Joined" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.createdAt
              ? formatDistanceToNow(new Date(row.original.createdAt), { addSuffix: true })
              : '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        cell: ({ row, table }) => {
          const m = row.original
          const tableMeta = table.options.meta as TableMeta | undefined
          const isSaving = savingId === m.id
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={(e) => e.stopPropagation()}
                  disabled={isSaving}
                >
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    tableMeta?.onView(m)
                  }}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  View
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    tableMeta?.onEdit(m)
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    downloadStaffDataSheet(m.id, m.staffCode)
                  }}
                >
                  <FileDown className="mr-2 h-4 w-4" />
                  Data sheet (PDF)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    tableMeta?.onToggleActive(m)
                  }}
                  className={m.isActive ? 'text-destructive' : undefined}
                >
                  {m.isActive ? (
                    <>
                      <ShieldOff className="mr-2 h-4 w-4" />
                      Deactivate
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Reactivate
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    tableMeta?.onDelete(m)
                  }}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [savingId, navigate]
  )

  // PR-14 — Internal/External filter dropped. External clinical providers
  // live in /hr/specialists now; no other "external staff" concept remains.
  const clinicalCount = members.filter((m) => m.isClinicalPractitioner).length

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Staff</h1>
          <p className="text-muted-foreground mt-1">
            All clinic staff. External clinical providers live under{' '}
            <Link to="/staff/specialists" className="underline hover:text-foreground">
              Specialists
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setInviteOpen(true)}>
            <Link2 className="mr-2 h-4 w-4" />
            Generate link
          </Button>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Staff
          </Button>
        </div>
      </div>

      <PendingRegistrationsCard onApproved={load} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </CardTitle>
            <CardDescription>{clinicalCount} clinical · click a row to view</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : members.length > 0 ? (
            <DataTable columns={columns} data={members} meta={meta} />
          ) : (
            <EmptyState
              icon={Users}
              title="No staff yet"
              description="Add your first staff member to start tracking attendance, payroll, credentials, and performance."
              action={{ label: 'Add staff', onClick: handleAdd }}
            />
          )}
        </CardContent>
      </Card>

      <GenerateInviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      <TeamMemberSheet open={sheetOpen} onOpenChange={setSheetOpen} onSave={handleSave} />

      <AlertDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deactivateTarget?.isActive ? 'Deactivate' : 'Reactivate'} {deactivateTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget?.isActive
                ? 'They will no longer be able to perform clinic actions or sign in to the portal. The record stays on file.'
                : 'They will regain access to the clinic and, if they have portal access, the portal.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeactivate}
              className={
                deactivateTarget?.isActive
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
            >
              {deactivateTarget?.isActive ? 'Deactivate' : 'Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PR-15 — Delete confirmation. Behaviour depends on whether the
          staff has a linked user: if yes → full offboard transaction
          (role + scopes + ban + soft-delete), if no → plain soft-delete. */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteTarget(null)
            setDeleteReason('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              Delete {deleteTarget?.name}?
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.userId ? (
                <>
                  Removes the role, revokes portal &amp; PWA access, bans the account, and
                  soft-deletes the staff record. All in one transaction.
                </>
              ) : (
                <>
                  Soft-deletes the staff record — they disappear from the list but their attendance,
                  documents, and history are kept on file.
                </>
              )}{' '}
              Reason is required (≥3 characters) and goes to the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-reason">Reason</Label>
            <Textarea
              id="delete-reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="e.g. Resignation effective today; equipment returned."
              rows={3}
              disabled={deleting}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting || deleteReason.trim().length < 3}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete staff member
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
