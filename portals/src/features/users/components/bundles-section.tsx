import { ChevronDown, ChevronRight, Network, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { setBundleParent } from '@/lib/actions/hr-phase2-4'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'

// ─── Types ────────────────────────────────────────────────────────────────────

type PermissionRow = {
  id: string
  module: string
  action: string
  description: string | null
}

type BundleSummary = {
  id: string
  name: string
  description: string | null
  scope: 'portal' | 'pwa' | 'all'
  isSystem: boolean
  parentBundleId?: string | null
}

type BundleDetail = BundleSummary & {
  permissions: PermissionRow[]
}

type EditState = {
  name: string
  description: string
  scope: 'portal' | 'pwa' | 'all'
  permissionIds: string[]
  parentBundleId: string | null
}

const NO_PARENT = '__no_parent__'
const EMPTY_EDIT: EditState = {
  name: '',
  description: '',
  scope: 'portal',
  permissionIds: [],
  parentBundleId: null,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupByModule(permissions: PermissionRow[]): Record<string, PermissionRow[]> {
  return permissions.reduce<Record<string, PermissionRow[]>>((acc, p) => {
    if (!acc[p.module]) acc[p.module] = []
    acc[p.module].push(p)
    return acc
  }, {})
}

// ─── Component ────────────────────────────────────────────────────────────────

const BUNDLES_KEY = ['roles', 'bundles'] as const
const BUNDLE_PERMISSIONS_KEY = ['roles', 'permissions'] as const

export function BundlesSection() {
  const bundlesQuery = useApiQuery(BUNDLES_KEY, () =>
    api.get<BundleSummary[]>('/api/roles/bundles/all')
  )
  const permissionsQuery = useApiQuery(BUNDLE_PERMISSIONS_KEY, () =>
    api.get<PermissionRow[]>('/api/roles/permissions/all')
  )
  const bundles = bundlesQuery.data ?? []
  const allPermissions = permissionsQuery.data ?? []
  const loading = bundlesQuery.isLoading || permissionsQuery.isLoading
  const error = bundlesQuery.isError ? 'Failed to load bundles' : null

  const reload = () => {
    void bundlesQuery.refetch()
    void permissionsQuery.refetch()
  }

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingBundle, setEditingBundle] = useState<BundleDetail | null>(null)
  const [editState, setEditState] = useState<EditState>(EMPTY_EDIT)
  const [saving, setSaving] = useState(false)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<BundleSummary | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Collapsed module groups in permission picker
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set())

  // ── Open create dialog ──────────────────────────────────────────────────────
  function openCreate() {
    setEditingBundle(null)
    setEditState(EMPTY_EDIT)
    // Start with all modules collapsed for cleaner UX
    setCollapsedModules(new Set(Object.keys(groupByModule(allPermissions))))
    setDialogOpen(true)
  }

  // ── Open edit dialog ────────────────────────────────────────────────────────
  async function openEdit(bundle: BundleSummary) {
    try {
      const d = await api.get<BundleDetail>(`/api/roles/bundles/${bundle.id}`)
      if (!d.success || !d.data) return
      setEditingBundle(d.data)
      setEditState({
        name: d.data.name,
        description: d.data.description ?? '',
        scope: d.data.scope,
        permissionIds: d.data.permissions.map((p) => p.id),
        parentBundleId: d.data.parentBundleId ?? null,
      })
      setCollapsedModules(new Set(Object.keys(groupByModule(allPermissions))))
      setDialogOpen(true)
    } catch {
      // silently fail
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    try {
      let bundleId: string | null = null
      if (editingBundle) {
        const body: Record<string, unknown> = { permissionIds: editState.permissionIds }
        if (!editingBundle.isSystem) {
          body.name = editState.name
          body.description = editState.description || null
          body.scope = editState.scope
        }
        await api.patch(`/api/roles/bundles/${editingBundle.id}`, body)
        bundleId = editingBundle.id
      } else {
        const res = await api.post<{ id: string }>('/api/roles/bundles', {
          name: editState.name,
          description: editState.description || null,
          scope: editState.scope,
          permissionIds: editState.permissionIds,
        })
        bundleId = (res.data as { id?: string } | undefined)?.id ?? null
      }

      // Parent bundle is set via a dedicated endpoint (cycle-detected on
      // the server). Skip the round-trip when the value didn't change.
      const currentParent = editingBundle?.parentBundleId ?? null
      if (bundleId && editState.parentBundleId !== currentParent) {
        await setBundleParent(bundleId, editState.parentBundleId)
      }

      setDialogOpen(false)
      await bundlesQuery.refetch()
    } catch {
      // leave open
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/api/roles/bundles/${deleteTarget.id}`)
      setDeleteTarget(null)
      await bundlesQuery.refetch()
    } catch {
      // silently fail
    } finally {
      setDeleting(false)
    }
  }

  function togglePermission(permId: string) {
    setEditState((s) => ({
      ...s,
      permissionIds: s.permissionIds.includes(permId)
        ? s.permissionIds.filter((id) => id !== permId)
        : [...s.permissionIds, permId],
    }))
  }

  function toggleModule(perms: PermissionRow[]) {
    const ids = perms.map((p) => p.id)
    const allChecked = ids.every((id) => editState.permissionIds.includes(id))
    setEditState((s) => ({
      ...s,
      permissionIds: allChecked
        ? s.permissionIds.filter((id) => !ids.includes(id))
        : [...new Set([...s.permissionIds, ...ids])],
    }))
  }

  function toggleCollapse(module: string) {
    setCollapsedModules((prev) => {
      const next = new Set(prev)
      next.has(module) ? next.delete(module) : next.add(module)
      return next
    })
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
        <Button variant="link" size="sm" className="ml-2 p-0" onClick={reload}>
          Retry
        </Button>
      </div>
    )
  }

  const grouped = groupByModule(allPermissions)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Bundles group related permissions. Compose roles from one or more bundles.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New Bundle
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bundle</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bundles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                  No bundles defined yet.
                </TableCell>
              </TableRow>
            ) : (
              bundles.map((bundle) => (
                <TableRow key={bundle.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{bundle.name}</span>
                      {bundle.isSystem && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <ShieldCheck className="h-3 w-3" />
                          System
                        </Badge>
                      )}
                    </div>
                    {bundle.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{bundle.description}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={bundle.scope === 'all' ? 'secondary' : 'outline'}
                      className="text-xs capitalize"
                    >
                      {bundle.scope}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Edit bundle"
                        onClick={() => openEdit(bundle)}
                        aria-label="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!bundle.isSystem && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Delete bundle"
                          onClick={() => setDeleteTarget(bundle)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingBundle ? `Edit Bundle: ${editingBundle.name}` : 'New Permission Bundle'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Name — hidden for system bundles */}
            {!editingBundle?.isSystem && (
              <div className="space-y-1.5">
                <Label htmlFor="bundle-name">Name</Label>
                <Input
                  id="bundle-name"
                  value={editState.name}
                  onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. Billing Read-Only"
                />
              </div>
            )}

            {/* Description */}
            {!editingBundle?.isSystem && (
              <div className="space-y-1.5">
                <Label htmlFor="bundle-desc">Description</Label>
                <Textarea
                  id="bundle-desc"
                  value={editState.description}
                  onChange={(e) => setEditState((s) => ({ ...s, description: e.target.value }))}
                  placeholder="What does this bundle grant access to?"
                  rows={2}
                />
              </div>
            )}

            {/* Scope */}
            {!editingBundle?.isSystem && (
              <div className="space-y-1.5">
                <Label>Scope</Label>
                <Select
                  value={editState.scope}
                  onValueChange={(v) =>
                    setEditState((s) => ({ ...s, scope: v as 'portal' | 'pwa' | 'all' }))
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portal">Portal</SelectItem>
                    <SelectItem value="pwa">PWA</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Parent bundle — Phase 4B composition. Permissions from the
                parent are inherited at resolve time; cycle detection lives
                on the server. */}
            <div className="space-y-1.5">
              <Label htmlFor="bundle-parent" className="flex items-center gap-1.5">
                <Network className="h-3.5 w-3.5" />
                Parent bundle
              </Label>
              <Select
                value={editState.parentBundleId ?? NO_PARENT}
                onValueChange={(v) =>
                  setEditState((s) => ({
                    ...s,
                    parentBundleId: v === NO_PARENT ? null : v,
                  }))
                }
              >
                <SelectTrigger id="bundle-parent">
                  <SelectValue placeholder="No parent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>
                    <span className="italic text-muted-foreground">No parent</span>
                  </SelectItem>
                  {bundles
                    .filter((b) => b.id !== editingBundle?.id)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Selecting a parent inherits its permissions at resolve time. Useful for "Doctor Full
                = Doctor Read + extras" patterns.
              </p>
            </div>

            {/* Permissions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Permissions</Label>
                <span className="text-xs text-muted-foreground">
                  {editState.permissionIds.length} selected
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                {Object.entries(grouped).map(([module, perms]) => {
                  const isCollapsed = collapsedModules.has(module)
                  const allChecked = perms.every((p) => editState.permissionIds.includes(p.id))
                  const someChecked = perms.some((p) => editState.permissionIds.includes(p.id))

                  return (
                    <div key={module} className="border-b border-border last:border-0">
                      {/* Module header */}
                      <div className="flex items-center gap-2 bg-muted/40 px-3 py-2">
                        <Checkbox
                          checked={allChecked}
                          data-indeterminate={someChecked && !allChecked}
                          onCheckedChange={() => toggleModule(perms)}
                        />
                        <button
                          type="button"
                          className="flex flex-1 items-center gap-1 text-left"
                          onClick={() => toggleCollapse(module)}
                        >
                          <span className="text-xs font-semibold uppercase tracking-wide">
                            {module.replace(/_/g, ' ')}
                          </span>
                          <span className="ml-auto mr-1 text-xs text-muted-foreground">
                            {perms.length}
                          </span>
                          {isCollapsed ? (
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                      </div>

                      {/* Permission rows */}
                      {!isCollapsed && (
                        <ul>
                          {perms.map((perm) => (
                            <li key={perm.id}>
                              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/30">
                                <Checkbox
                                  checked={editState.permissionIds.includes(perm.id)}
                                  onCheckedChange={() => togglePermission(perm.id)}
                                />
                                <div className="flex flex-1 items-center justify-between gap-2">
                                  <span className="text-sm capitalize">
                                    {perm.action.replace(/_/g, ' ')}
                                  </span>
                                  {perm.description && (
                                    <span className="truncate text-xs text-muted-foreground">
                                      {perm.description}
                                    </span>
                                  )}
                                </div>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || (!editingBundle && !editState.name.trim())}
            >
              {saving ? 'Saving…' : editingBundle ? 'Save Changes' : 'Create Bundle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Bundle</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-foreground">{deleteTarget?.name}</span>? Remove it
            from all roles first.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete Bundle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
