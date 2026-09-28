import { Search, ShieldQuestion, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { bulkAssignRole, type WhoCanDoResult, whoCanDo } from '@/lib/actions/access-management'
import { getRoles } from '@/lib/actions/users'
import { api } from '@/lib/api-client'
import { MODULES } from '@/lib/modules'
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
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'

// Permission-module slugs sourced from the RBAC source of truth (@denel/rbac)
// so the "Who can do X?" picker never drifts from the real module set.
const COMMON_MODULES = (Object.values(MODULES) as string[]).sort()

const ACTIONS_LIST = ['read', 'create', 'update', 'delete'] as const
const UNASSIGNED = '__unassigned__'

// No shared query-key group exists for this admin surface — local literals,
// module-scoped, used by both the staff list read and the bulk-role mutation.
const ACCESS_MGMT_STAFF_KEY = ['access-management', 'staff'] as const
const ACCESS_MGMT_ROLES_KEY = ['access-management', 'roles'] as const

type StaffRow = {
  id: string
  staffRecordId: string | null
  name: string
  email: string | null
  role: string | null
  staffType?: string | null
}

export default function AccessManagementOverviewPage() {
  const [search, setSearch] = useState('')
  const [whoCanOpen, setWhoCanOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  const {
    data: staff = [],
    error: staffError,
    refetch: reloadStaff,
  } = useApiQuery(
    ACCESS_MGMT_STAFF_KEY,
    () => api.get<{ staff: Array<StaffRow & { id: string }> }>('/api/access-management'),
    { select: (d) => d.staff }
  )

  useEffect(() => {
    if (staffError) toast.error('Failed to load staff. Please refresh.')
  }, [staffError])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return staff.slice(0, 8)
    return staff
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.email ?? '').toLowerCase().includes(q) ||
          (s.role ?? '').toLowerCase().includes(q)
      )
      .slice(0, 20)
  }, [staff, search])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ── Quick search → deep-link ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            Find someone
          </CardTitle>
          <CardDescription>
            Jump straight to a staff member's Permissions tab to change role, scope, or offboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Search by name, email, or role…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No staff match.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {filtered.map((s) => (
                <li key={s.id}>
                  <Link
                    to={s.staffRecordId ? `/hr/${s.staffRecordId}?tab=permissions` : '/hr/staff'}
                    className="flex items-center justify-between gap-3 p-3 hover:bg-muted/30"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.email ?? '—'}</p>
                    </div>
                    {s.role && (
                      <Badge variant="secondary" className="capitalize text-xs">
                        {s.role.replace(/_/g, ' ')}
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Cross-cutting tools ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Bulk role assign
            </CardTitle>
            <CardDescription>
              Apply one role to many staff at once. Used when a team is restructured or a new system
              role rolls out.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setBulkOpen(true)} variant="outline">
              Open bulk assigner
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldQuestion className="h-4 w-4" />
              Who can do X?
            </CardTitle>
            <CardDescription>
              Reverse lookup. Pick a (module, action) and see which roles + users hold it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setWhoCanOpen(true)} variant="outline">
              Run audit
            </Button>
          </CardContent>
        </Card>
      </div>

      <WhoCanDoSheet open={whoCanOpen} onOpenChange={setWhoCanOpen} />
      <BulkRoleSheet
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        staff={staff}
        onAssigned={reloadStaff}
      />
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────

function WhoCanDoSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [moduleName, setModuleName] = useState<string>(COMMON_MODULES[0])
  const [action, setAction] = useState<string>(ACTIONS_LIST[0])
  const [result, setResult] = useState<WhoCanDoResult | null>(null)
  const [loading, setLoading] = useState(false)

  async function runLookup() {
    setLoading(true)
    const res = await whoCanDo(moduleName, action)
    setLoading(false)
    if (!res.success || !res.data) {
      toast.error(res.error || 'Lookup failed')
      return
    }
    setResult(res.data)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>Who can do X?</SheetTitle>
          <SheetDescription>
            Returns every role + user that holds (module, action). Admin bypass is flagged
            separately.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Module</Label>
              <Select value={moduleName} onValueChange={setModuleName}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_MODULES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Action</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS_LIST.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={runLookup} disabled={loading}>
            {loading ? 'Looking up…' : 'Run lookup'}
          </Button>

          {result && (
            <div className="space-y-3 pt-2">
              {result.adminBypass && (
                <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                  Admins bypass this check via the admin-role short-circuit.
                </div>
              )}
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">
                  Roles ({result.viaRoles.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.viaRoles.map((r) => (
                    <Badge key={r} variant="secondary" className="text-xs">
                      {r}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">
                  Users ({result.users.length})
                </p>
                <ul className="space-y-1.5">
                  {result.users.map((u) => (
                    <li key={u.id} className="text-sm">
                      <span className="font-medium">{u.name}</span>
                      <span className="text-muted-foreground"> · {u.email}</span>
                      {u.banned && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">
                          Banned
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function BulkRoleSheet({
  open,
  onOpenChange,
  staff,
  onAssigned,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: StaffRow[]
  onAssigned: () => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [role, setRole] = useState<string>(UNASSIGNED)

  // Live roles from the RBAC source of truth — replaces the former __mock__ list.
  // Gated on `open` — no point fetching until the sheet is actually shown.
  const { data: roleOptions = [] } = useApiQuery(ACCESS_MGMT_ROLES_KEY, () => getRoles(), {
    select: (rows) =>
      // value MUST be the role id ('admin', 'doctor', …) — that's the slug the
      // backend bulk-role validator checks; `name` is the display label.
      (rows as Array<{ id: string; name?: string | null }>).map((r) => ({
        value: r.id,
        label: r.name || r.id.replace(/_/g, ' '),
      })),
    enabled: open,
    staleTime: 5 * 60_000,
  })

  const bulkAssign = useApiMutation(
    (vars: { userIds: string[]; role: string | null }) => bulkAssignRole(vars.userIds, vars.role),
    { invalidates: [ACCESS_MGMT_STAFF_KEY] }
  )

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAssign() {
    if (selectedIds.size === 0) return
    try {
      const data = await bulkAssign.mutateAsync({
        userIds: Array.from(selectedIds),
        role: role === UNASSIGNED ? null : role,
      })
      toast.success(`Updated ${data?.updated ?? selectedIds.size} user(s).`)
      setSelectedIds(new Set())
      onOpenChange(false)
      onAssigned()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk assign failed')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[520px] sm:max-w-[520px]">
        <SheetHeader>
          <SheetTitle>Bulk role assign</SheetTitle>
          <SheetDescription>
            Apply one role to many staff in one transaction. Up to 100 at a time.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Role to assign</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>
                  <span className="italic text-muted-foreground">Unassign role</span>
                </SelectItem>
                {roleOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="capitalize">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="max-h-[400px] overflow-y-auto rounded-md border">
            <ul className="divide-y">
              {staff.map((s) => (
                <li key={s.id} className="flex items-center gap-3 p-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(s.id)}
                    onChange={() => toggle(s.id)}
                    aria-label={`Select ${s.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.email ?? '—'}</p>
                  </div>
                  {s.role && (
                    <Badge variant="secondary" className="capitalize text-xs">
                      {s.role.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{selectedIds.size} selected (max 100)</p>
            <Button
              onClick={handleAssign}
              disabled={bulkAssign.isPending || selectedIds.size === 0}
            >
              {bulkAssign.isPending ? 'Applying…' : 'Apply role'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
