import { ArrowRight, Minus, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api-client'
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

type RoleSummary = {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  scopes: string[]
  bundleCount: number
}

type BundleSummary = {
  id: string
  name: string
  description: string | null
  scope: string
  isSystem: boolean
}

type RoleDetail = RoleSummary & {
  bundles: BundleSummary[]
}

type EditState = {
  name: string
  description: string
  scopes: ('portal' | 'pwa')[]
  bundleIds: string[]
}

const EMPTY_EDIT: EditState = { name: '', description: '', scopes: [], bundleIds: [] }

// ─── Component ────────────────────────────────────────────────────────────────

export function RolesSection() {
  const [roles, setRoles] = useState<RoleSummary[]>([])
  const [allBundles, setAllBundles] = useState<BundleSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleDetail | null>(null)
  const [editState, setEditState] = useState<EditState>(EMPTY_EDIT)
  // Snapshot of the editState when the dialog opened — used to render the
  // diff preview ("X bundles added, Y removed") so the admin can review
  // before committing.
  const [originalState, setOriginalState] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<RoleSummary | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rd, bd] = await Promise.all([
        api.get<RoleSummary[]>('/api/roles'),
        api.get<BundleSummary[]>('/api/roles/bundles/all'),
      ])
      if (rd.success && rd.data) setRoles(rd.data)
      if (bd.success && bd.data) setAllBundles(bd.data)
      if (!rd.success) setError('Failed to load roles')
    } catch {
      setError('Failed to load roles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // ── Open create dialog ──────────────────────────────────────────────────────
  function openCreate() {
    setEditingRole(null)
    setEditState(EMPTY_EDIT)
    setOriginalState(null) // create flow — no diff to preview
    setDialogOpen(true)
  }

  // ── Open edit dialog ────────────────────────────────────────────────────────
  async function openEdit(role: RoleSummary) {
    try {
      const d = await api.get<RoleDetail>(`/api/roles/${role.id}`)
      if (!d.success || !d.data) return
      const initial: EditState = {
        name: d.data.name,
        description: d.data.description ?? '',
        scopes: d.data.scopes as ('portal' | 'pwa')[],
        bundleIds: d.data.bundles.map((b) => b.id),
      }
      setEditingRole(d.data)
      setEditState(initial)
      setOriginalState(initial)
      setDialogOpen(true)
    } catch {
      // silently fail — user can retry
    }
  }

  // ── Save (create or update) ─────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    try {
      if (editingRole) {
        const ops: Promise<unknown>[] = [
          api.put(`/api/roles/${editingRole.id}/bundles`, { bundleIds: editState.bundleIds }),
          api.put(`/api/roles/${editingRole.id}/scopes`, { scopes: editState.scopes }),
        ]
        if (!editingRole.isSystem) {
          ops.push(
            api.patch(`/api/roles/${editingRole.id}`, {
              name: editState.name,
              description: editState.description || null,
            })
          )
        }
        await Promise.all(ops)
      } else {
        await api.post('/api/roles', {
          name: editState.name,
          description: editState.description || null,
          scopes: editState.scopes,
          bundleIds: editState.bundleIds,
        })
      }
      setDialogOpen(false)
      await load()
    } catch {
      // leave dialog open so user can retry
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/api/roles/${deleteTarget.id}`)
      setDeleteTarget(null)
      await load()
    } catch {
      // silently fail
    } finally {
      setDeleting(false)
    }
  }

  function toggleScope(scope: 'portal' | 'pwa') {
    setEditState((s) => ({
      ...s,
      scopes: s.scopes.includes(scope)
        ? s.scopes.filter((sc) => sc !== scope)
        : [...s.scopes, scope],
    }))
  }

  function toggleBundle(bundleId: string) {
    setEditState((s) => ({
      ...s,
      bundleIds: s.bundleIds.includes(bundleId)
        ? s.bundleIds.filter((id) => id !== bundleId)
        : [...s.bundleIds, bundleId],
    }))
  }

  // ── Diff preview ────────────────────────────────────────────────────────────
  // Compare the current edit state against the snapshot captured on open and
  // surface what will change. Helps the admin avoid stripping the wrong bundle
  // or scope before the (irreversible) write fans out across three endpoints.
  const bundleNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of allBundles) m.set(b.id, b.name)
    return m
  }, [allBundles])

  const diff = useMemo(() => {
    if (!originalState) return null
    const origBundles = new Set(originalState.bundleIds)
    const nextBundles = new Set(editState.bundleIds)
    const addedBundles = editState.bundleIds.filter((id) => !origBundles.has(id))
    const removedBundles = originalState.bundleIds.filter((id) => !nextBundles.has(id))

    const origScopes = new Set(originalState.scopes)
    const nextScopes = new Set(editState.scopes)
    const addedScopes = editState.scopes.filter((s) => !origScopes.has(s))
    const removedScopes = originalState.scopes.filter((s) => !nextScopes.has(s))

    const nameChanged = editState.name !== originalState.name
    const descChanged = editState.description !== originalState.description

    const hasChanges =
      addedBundles.length > 0 ||
      removedBundles.length > 0 ||
      addedScopes.length > 0 ||
      removedScopes.length > 0 ||
      nameChanged ||
      descChanged
    return {
      hasChanges,
      addedBundles,
      removedBundles,
      addedScopes,
      removedScopes,
      nameChanged,
      descChanged,
    }
  }, [originalState, editState])

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
        <Button variant="link" size="sm" className="ml-2 p-0" onClick={load}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define roles and compose them from permission bundles. System roles cannot be deleted.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New Role
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead className="text-center">Bundles</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  No roles defined yet.
                </TableCell>
              </TableRow>
            ) : (
              roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{role.name}</span>
                      {role.isSystem && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <ShieldCheck className="h-3 w-3" />
                          System
                        </Badge>
                      )}
                    </div>
                    {role.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{role.description}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      {role.scopes.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        role.scopes.map((scope) => (
                          <Badge key={scope} variant="outline" className="text-xs capitalize">
                            {scope}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {role.bundleCount}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Edit role"
                        onClick={() => openEdit(role)}
                        aria-label="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!role.isSystem && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Delete role"
                          onClick={() => setDeleteTarget(role)}
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
            <DialogTitle>{editingRole ? `Edit Role: ${editingRole.name}` : 'New Role'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Name — hidden for system roles */}
            {!editingRole?.isSystem && (
              <div className="space-y-1.5">
                <Label htmlFor="role-name">Name</Label>
                <Input
                  id="role-name"
                  value={editState.name}
                  onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. Billing Manager"
                />
              </div>
            )}

            {/* Description — hidden for system roles */}
            {!editingRole?.isSystem && (
              <div className="space-y-1.5">
                <Label htmlFor="role-desc">Description</Label>
                <Textarea
                  id="role-desc"
                  value={editState.description}
                  onChange={(e) => setEditState((s) => ({ ...s, description: e.target.value }))}
                  placeholder="Brief description of this role's responsibilities"
                  rows={2}
                />
              </div>
            )}

            {/* Scopes */}
            <div className="space-y-2">
              <Label>Application Access</Label>
              <p className="text-xs text-muted-foreground">
                Which interfaces can users with this role log into?
              </p>
              <div className="flex gap-4">
                {(['portal', 'pwa'] as const).map((scope) => (
                  <label key={scope} className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={editState.scopes.includes(scope)}
                      onCheckedChange={() => toggleScope(scope)}
                    />
                    <span className="text-sm capitalize">{scope}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Bundles */}
            <div className="space-y-2">
              <Label>Permission Bundles</Label>
              <p className="text-xs text-muted-foreground">
                Select the bundles that define what this role can do.
              </p>
              <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                {allBundles.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">No bundles available.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {allBundles.map((bundle) => (
                      <li key={bundle.id}>
                        <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/50">
                          <Checkbox
                            className="mt-0.5"
                            checked={editState.bundleIds.includes(bundle.id)}
                            onCheckedChange={() => toggleBundle(bundle.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium">{bundle.name}</span>
                              <Badge variant="outline" className="text-[10px] capitalize">
                                {bundle.scope}
                              </Badge>
                              {bundle.isSystem && (
                                <Badge variant="secondary" className="text-[10px]">
                                  System
                                </Badge>
                              )}
                            </div>
                            {bundle.description && (
                              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                                {bundle.description}
                              </p>
                            )}
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Diff preview — only when editing an existing role and something
              has actually changed. Keeps the admin honest before the save
              fans out across three endpoints. */}
          {diff?.hasChanges && (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-medium">
                <ArrowRight className="h-3.5 w-3.5" />
                Pending changes
              </div>
              {diff.nameChanged && (
                <div className="text-muted-foreground">
                  Name: <span className="text-foreground">{originalState?.name || '—'}</span> →{' '}
                  <span className="text-foreground">{editState.name || '—'}</span>
                </div>
              )}
              {diff.descChanged && <div className="text-muted-foreground">Description updated</div>}
              {diff.addedScopes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">Scopes added:</span>
                  {diff.addedScopes.map((s) => (
                    <Badge
                      key={s}
                      variant="outline"
                      className="border-emerald-500/50 text-[10px] text-emerald-700 dark:text-emerald-400"
                    >
                      <Plus className="mr-0.5 h-2.5 w-2.5" />
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
              {diff.removedScopes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">Scopes removed:</span>
                  {diff.removedScopes.map((s) => (
                    <Badge
                      key={s}
                      variant="outline"
                      className="border-destructive/50 text-[10px] text-destructive"
                    >
                      <Minus className="mr-0.5 h-2.5 w-2.5" />
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
              {diff.addedBundles.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">Bundles added:</span>
                  {diff.addedBundles.map((id) => (
                    <Badge
                      key={id}
                      variant="outline"
                      className="border-emerald-500/50 text-[10px] text-emerald-700 dark:text-emerald-400"
                    >
                      <Plus className="mr-0.5 h-2.5 w-2.5" />
                      {bundleNameById.get(id) ?? id}
                    </Badge>
                  ))}
                </div>
              )}
              {diff.removedBundles.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">Bundles removed:</span>
                  {diff.removedBundles.map((id) => (
                    <Badge
                      key={id}
                      variant="outline"
                      className="border-destructive/50 text-[10px] text-destructive"
                    >
                      <Minus className="mr-0.5 h-2.5 w-2.5" />
                      {bundleNameById.get(id) ?? id}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                saving ||
                (!editingRole && !editState.name.trim()) ||
                (editingRole != null && diff != null && !diff.hasChanges)
              }
            >
              {saving ? 'Saving…' : editingRole ? 'Save Changes' : 'Create Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Role</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-foreground">{deleteTarget?.name}</span>? Users
            assigned to this role must be reassigned first.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
