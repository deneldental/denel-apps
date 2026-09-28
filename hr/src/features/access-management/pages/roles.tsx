import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@denel/ui'
import { Loader2, Lock, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type Bundle,
  createRole,
  deleteRole,
  getRole,
  listAllBundles,
  listRoles,
  type RoleDetail,
  type RoleSummary,
  setRoleBundles,
  setRoleScopes,
  updateRole,
} from '@/lib/actions/roles'
import { TagBadge } from '@/shared/components/tag-badge'

const SCOPES: Array<{ value: string; label: string }> = [
  { value: 'portal', label: 'Portal (management)' },
  { value: 'pwa', label: 'Team app (PWA)' },
  { value: 'hr', label: 'HR app' },
]

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleSummary[]>([])
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [r, b] = await Promise.all([listRoles(), listAllBundles()])
    if (r.success && Array.isArray(r.data)) setRoles(r.data)
    if (b.success && Array.isArray(b.data)) setBundles(b.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Roles bundle permissions and interface scopes. System roles are slug-locked.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New role
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {roles.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold capitalize">{r.name}</span>
                    {r.isSystem && (
                      <TagBadge className="gap-1 text-[10px]">
                        <Lock className="h-3 w-3" />
                        System
                      </TagBadge>
                    )}
                  </div>
                  {r.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.scopes.length ? (
                      r.scopes.map((s) => (
                        <TagBadge key={s} label={s} className="text-[10px] capitalize">
                          {s}
                        </TagBadge>
                      ))
                    ) : (
                      <span className="text-[11px] text-muted-foreground">no scopes</span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      · {r.bundleCount} bundle{r.bundleCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                {r.id !== 'admin' && (
                  <Button size="sm" variant="outline" onClick={() => setEditId(r.id)}>
                    Edit
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditRoleSheet
        roleId={editId}
        bundles={bundles}
        onClose={() => setEditId(null)}
        onSaved={() => {
          setEditId(null)
          void load()
        }}
      />

      <CreateRoleDialog
        open={creating}
        bundles={bundles}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false)
          void load()
        }}
      />
    </div>
  )
}

// ── Edit role ────────────────────────────────────────────────────────────────

function EditRoleSheet({
  roleId,
  bundles,
  onClose,
  onSaved,
}: {
  roleId: string | null
  bundles: Bundle[]
  onClose: () => void
  onSaved: () => void
}) {
  const [detail, setDetail] = useState<RoleDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scopes, setScopes] = useState<Set<string>>(new Set())
  const [bundleIds, setBundleIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!roleId) return
    let cancelled = false
    setLoading(true)
    getRole(roleId).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.success && res.data) {
        setDetail(res.data)
        setName(res.data.name)
        setDescription(res.data.description ?? '')
        setScopes(new Set(res.data.scopes))
        setBundleIds(new Set(res.data.bundles.map((b) => b.id)))
      } else {
        toast.error(res.error || 'Failed to load role')
      }
    })
    return () => {
      cancelled = true
    }
  }, [roleId])

  async function handleSave() {
    if (!detail) return
    setBusy(true)
    const results = await Promise.all([
      setRoleScopes(detail.id, [...scopes]),
      setRoleBundles(detail.id, [...bundleIds]),
      ...(!detail.isSystem ? [updateRole(detail.id, { name, description })] : []),
    ])
    setBusy(false)
    if (results.every((r) => r.success)) {
      toast.success('Role updated')
      onSaved()
    } else {
      toast.error(results.find((r) => !r.success)?.error || 'Failed to save role')
    }
  }

  async function handleDelete() {
    if (!detail || detail.isSystem) return
    setBusy(true)
    const res = await deleteRole(detail.id)
    setBusy(false)
    if (res.success) {
      toast.success('Role deleted')
      onSaved()
    } else {
      toast.error(res.error || 'In use — reassign its users first')
    }
  }

  return (
    <Sheet open={!!roleId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit role</SheetTitle>
          <SheetDescription>Interface scopes and permission bundles.</SheetDescription>
        </SheetHeader>

        {loading || !detail ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {!detail.isSystem ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="role-name">Name</Label>
                  <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role-desc">Description</Label>
                  <Textarea
                    id="role-desc"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Lock className="mr-1 inline h-3 w-3" />
                System role — name is locked. You can still adjust its scopes and bundles.
              </p>
            )}

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Interface scopes</Label>
              {SCOPES.map((s) => (
                <label key={s.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={scopes.has(s.value)}
                    onCheckedChange={(v) =>
                      setScopes((prev) => {
                        const next = new Set(prev)
                        if (v) next.add(s.value)
                        else next.delete(s.value)
                        return next
                      })
                    }
                  />
                  {s.label}
                </label>
              ))}
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Permission bundles</Label>
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {bundles.map((b) => (
                  <label key={b.id} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={bundleIds.has(b.id)}
                      onCheckedChange={(v) =>
                        setBundleIds((prev) => {
                          const next = new Set(prev)
                          if (v) next.add(b.id)
                          else next.delete(b.id)
                          return next
                        })
                      }
                    />
                    <span>
                      {b.name}
                      <TagBadge label={b.scope} className="ml-1.5 text-[9px] uppercase">
                        {b.scope}
                      </TagBadge>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              {!detail.isSystem ? (
                <Button variant="ghost" size="sm" onClick={handleDelete} disabled={busy}>
                  <Trash2 className="mr-1.5 h-4 w-4 text-destructive" />
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={handleSave} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Create role ──────────────────────────────────────────────────────────────

function CreateRoleDialog({
  open,
  bundles,
  onClose,
  onCreated,
}: {
  open: boolean
  bundles: Bundle[]
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scopes, setScopes] = useState<Set<string>>(new Set(['pwa']))
  const [bundleIds, setBundleIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setName('')
      setDescription('')
      setScopes(new Set(['pwa']))
      setBundleIds(new Set())
    }
  }, [open])

  async function handleCreate() {
    if (!name.trim()) return toast.error('Enter a role name')
    setBusy(true)
    const res = await createRole({
      name: name.trim(),
      description: description.trim() || undefined,
      scopes: [...scopes],
      bundleIds: [...bundleIds],
    })
    setBusy(false)
    if (res.success) {
      toast.success('Role created')
      onCreated()
    } else {
      toast.error(res.error || 'Failed to create role')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>Create a custom role with scopes and bundles.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-role-name">Name</Label>
            <Input
              id="new-role-name"
              placeholder="e.g. Front Desk Lead"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-role-desc">Description</Label>
            <Textarea
              id="new-role-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Interface scopes</Label>
            {SCOPES.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={scopes.has(s.value)}
                  onCheckedChange={(v) =>
                    setScopes((prev) => {
                      const next = new Set(prev)
                      if (v) next.add(s.value)
                      else next.delete(s.value)
                      return next
                    })
                  }
                />
                {s.label}
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Permission bundles</Label>
            <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border p-2">
              {bundles.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={bundleIds.has(b.id)}
                    onCheckedChange={(v) =>
                      setBundleIds((prev) => {
                        const next = new Set(prev)
                        if (v) next.add(b.id)
                        else next.delete(b.id)
                        return next
                      })
                    }
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
