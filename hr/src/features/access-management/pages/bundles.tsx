import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@denel/ui'
import { cn } from '@denel/utils'
import { Loader2, Lock, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type Bundle,
  type BundleScope,
  createBundle,
  deleteBundle,
  getBundle,
  listAllBundles,
  listAllPermissions,
  type PermissionRow,
  updateBundle,
} from '@/lib/actions/roles'
import { TagBadge } from '@/shared/components/tag-badge'

const SCOPE_OPTIONS: BundleScope[] = ['portal', 'pwa', 'all']
const NEW = '__new__'

export default function BundlesPage() {
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [b, p] = await Promise.all([listAllBundles(), listAllPermissions()])
    if (b.success && Array.isArray(b.data)) setBundles(b.data)
    if (p.success && Array.isArray(p.data)) setPermissions(p.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Bundles are reusable sets of permissions. Attach them to roles (or grant per-user).
        </p>
        <Button size="sm" onClick={() => setEditId(NEW)}>
          <Plus className="mr-2 h-4 w-4" />
          New bundle
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {bundles.map((b) => (
            <Card key={b.id}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{b.name}</span>
                    <TagBadge label={b.scope} className="text-[9px] uppercase">
                      {b.scope}
                    </TagBadge>
                    {b.isSystem && (
                      <TagBadge className="gap-1 text-[10px]">
                        <Lock className="h-3 w-3" />
                        System
                      </TagBadge>
                    )}
                  </div>
                  {b.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{b.description}</p>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditId(b.id)}>
                  Edit
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BundleSheet
        bundleId={editId}
        allPermissions={permissions}
        onClose={() => setEditId(null)}
        onSaved={() => {
          setEditId(null)
          void load()
        }}
      />
    </div>
  )
}

function BundleSheet({
  bundleId,
  allPermissions,
  onClose,
  onSaved,
}: {
  bundleId: string | null
  allPermissions: PermissionRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = bundleId === NEW
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isSystem, setIsSystem] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<BundleScope>('pwa')
  const [permIds, setPermIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!bundleId) return
    if (isNew) {
      setIsSystem(false)
      setName('')
      setDescription('')
      setScope('pwa')
      setPermIds(new Set())
      return
    }
    let cancelled = false
    setLoading(true)
    getBundle(bundleId).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.success && res.data) {
        setIsSystem(res.data.isSystem)
        setName(res.data.name)
        setDescription(res.data.description ?? '')
        setScope(res.data.scope)
        setPermIds(new Set(res.data.permissions.map((p) => p.id)))
      } else {
        toast.error(res.error || 'Failed to load bundle')
      }
    })
    return () => {
      cancelled = true
    }
  }, [bundleId, isNew])

  // Group permissions by module for display.
  const grouped = useMemo(() => {
    const map = new Map<string, PermissionRow[]>()
    for (const p of allPermissions) {
      if (!map.has(p.module)) map.set(p.module, [])
      map.get(p.module)?.push(p)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [allPermissions])

  async function handleSave() {
    if (!name.trim()) return toast.error('Enter a bundle name')
    if (!bundleId) return
    setBusy(true)
    const permissionIds = [...permIds]
    const res = isNew
      ? await createBundle({
          name: name.trim(),
          description: description.trim(),
          scope,
          permissionIds,
        })
      : await updateBundle(bundleId, {
          permissionIds,
          ...(isSystem ? {} : { name: name.trim(), description: description.trim(), scope }),
        })
    setBusy(false)
    if (res.success) {
      toast.success(isNew ? 'Bundle created' : 'Bundle updated')
      onSaved()
    } else {
      toast.error(res.error || 'Failed to save bundle')
    }
  }

  async function handleDelete() {
    if (isNew || !bundleId || isSystem) return
    setBusy(true)
    const res = await deleteBundle(bundleId)
    setBusy(false)
    if (res.success) {
      toast.success('Bundle deleted')
      onSaved()
    } else {
      toast.error(res.error || 'In use — detach it from roles first')
    }
  }

  return (
    <Sheet open={!!bundleId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{isNew ? 'New bundle' : 'Edit bundle'}</SheetTitle>
          <SheetDescription>A named set of permissions.</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="b-name">Name</Label>
                <Input
                  id="b-name"
                  value={name}
                  disabled={isSystem}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Scope</Label>
                <Select
                  value={scope}
                  onValueChange={(v) => setScope(v as BundleScope)}
                  disabled={isSystem}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="uppercase">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-desc">Description</Label>
              <Textarea
                id="b-desc"
                rows={2}
                value={description}
                disabled={isSystem}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Permissions ({permIds.size} selected)
              </Label>
              <div className="max-h-[45vh] space-y-3 overflow-y-auto rounded-md border p-3">
                {grouped.map(([module, perms]) => (
                  <div key={module}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {module.replace(/_/g, ' ')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {perms.map((p) => {
                        const on = permIds.has(p.id)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              setPermIds((prev) => {
                                const next = new Set(prev)
                                if (next.has(p.id)) next.delete(p.id)
                                else next.add(p.id)
                                return next
                              })
                            }
                            className={cn(
                              'rounded-md border px-2 py-1 text-xs transition-colors',
                              on
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border text-muted-foreground hover:border-primary/40'
                            )}
                          >
                            {p.action}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              {!isNew && !isSystem ? (
                <Button variant="ghost" size="sm" onClick={handleDelete} disabled={busy}>
                  <Trash2 className="mr-1.5 h-4 w-4 text-destructive" />
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={handleSave} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isNew ? 'Create bundle' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
