import { Loader2, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createToothClass,
  deleteToothClass,
  getToothClasses,
  restoreToothClass,
  type ToothClass,
  updateToothClass,
} from '@/lib/actions/services'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Switch } from '@/shared/components/ui/switch'
import { useConfirm } from '@/shared/hooks/use-confirm'

/**
 * Tooth-class management — the second pricing-matrix lookup, administered
 * alongside application types. A tooth class is the friendly, renamable grouping
 * a per-tooth service is priced by (molar / premolar / canine / incisor …); the
 * pricing matrix reads them when a scope's variant type is "tooth_class".
 * The code (`name`) is fixed at creation; only the display name, order and
 * active flag are editable afterwards.
 */
export function ToothClassSection({ isAdmin }: { isAdmin: boolean }) {
  const { confirm, confirmDialog } = useConfirm()
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<ToothClass | 'new' | null>(null)

  const classesQuery = useApiQuery<ToothClass[]>(
    queryKeys.services.toothClasses(true, showRetired),
    () => getToothClasses(true, showRetired)
  )
  const classes = classesQuery.data ?? []
  const loading = classesQuery.isLoading

  const restoreMutation = useApiMutation((id: string) => restoreToothClass(id), {
    invalidates: [queryKeys.services.all],
  })
  const deleteMutation = useApiMutation((id: string) => deleteToothClass(id), {
    invalidates: [queryKeys.services.all],
  })
  const updateMutation = useApiMutation(
    (vars: { id: string; data: Partial<ToothClass> }) => updateToothClass(vars.id, vars.data),
    { invalidates: [queryKeys.services.all] }
  )

  async function handleRestore(t: ToothClass) {
    try {
      await restoreMutation.mutateAsync(t.id)
      // Comes back INACTIVE — re-offering it is a separate, deliberate step.
      toast.success(`"${t.displayName || t.name}" restored (inactive).`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore tooth class')
    }
  }

  async function handleDelete(t: ToothClass) {
    const ok = await confirm({
      title: 'Delete tooth class',
      description:
        'It is retired from the pricing matrix and every picker. Invoice lines already priced by it keep working. Refused if it priced a billed line.',
      itemName: t.displayName || t.name,
    })
    if (!ok) return

    try {
      await deleteMutation.mutateAsync(t.id)
      toast.success(`"${t.displayName || t.name}" deleted.`)
    } catch (err) {
      // A 409 carries the real reason — show it verbatim.
      toast.error(err instanceof Error ? err.message : 'Failed to delete tooth class')
    }
  }

  async function toggleActive(t: ToothClass, isActive: boolean) {
    try {
      await updateMutation.mutateAsync({ id: t.id, data: { isActive } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Tooth classes</p>
          <p className="text-xs text-muted-foreground">
            The friendly tooth groupings a per-tooth service is priced by — used by the pricing
            matrix when an application type prices "by tooth class".
          </p>
        </div>
        {/* Authoring tooth classes is admin-only — hidden, not disabled, for
            everyone else so the section reads as a plain reference list. */}
        <div className="flex items-center gap-3">
          {isAdmin && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={showRetired}
                onCheckedChange={setShowRetired}
                disabled={loading}
                aria-label="Show retired"
              />
              Show retired
            </label>
          )}
          {isAdmin && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New tooth class
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : classes.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No tooth classes yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-right">Order</th>
                <th className="px-3 py-2 text-center">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {classes.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="px-3 py-2 font-medium">
                    <span className={t.deletedAt ? 'text-muted-foreground line-through' : ''}>
                      {t.displayName}
                    </span>
                    {t.deletedAt && (
                      <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">
                        Retired
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.sortOrder}</td>
                  <td className="px-3 py-2 text-center">
                    <Switch
                      checked={t.isActive}
                      onCheckedChange={(v) => toggleActive(t, v)}
                      disabled={!isAdmin}
                      aria-label="Active"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isAdmin &&
                      (t.deletedAt ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleRestore(t)}
                          aria-label="Restore"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditing(t)}
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(t)}
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ToothClassFormSheet
          toothClass={editing === 'new' ? null : editing}
          isAdmin={isAdmin}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {confirmDialog}
    </div>
  )
}

function ToothClassFormSheet({
  toothClass,
  isAdmin,
  onClose,
  onSaved,
}: {
  toothClass: ToothClass | null
  isAdmin: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [displayName, setDisplayName] = useState(toothClass?.displayName ?? '')
  const [sortOrder, setSortOrder] = useState(
    toothClass?.sortOrder != null ? String(toothClass.sortOrder) : ''
  )
  const [isActive, setIsActive] = useState(toothClass?.isActive ?? true)

  // Create has no isActive param (new classes are active); only the PATCH
  // accepts it, so the Active switch is edit-only.
  const saveMutation = useApiMutation(
    (vars: { displayName: string; sortOrder: number; isActive?: boolean }) =>
      toothClass
        ? updateToothClass(toothClass.id, vars)
        : createToothClass({ name: vars.displayName, ...vars }),
    { invalidates: [queryKeys.services.all] }
  )
  const saving = saveMutation.isPending

  async function save() {
    if (!displayName.trim()) {
      toast.error('A name is required.')
      return
    }
    const order = sortOrder.trim() === '' ? 0 : Number(sortOrder)
    try {
      await saveMutation.mutateAsync(
        toothClass
          ? { displayName: displayName.trim(), sortOrder: order, isActive }
          : { displayName: displayName.trim(), sortOrder: order }
      )
      toast.success(toothClass ? 'Tooth class updated.' : 'Tooth class created.')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save tooth class')
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="!w-full overflow-y-auto sm:!max-w-[480px]">
        <SheetHeader className="mb-2">
          <SheetTitle>{toothClass ? 'Edit' : 'New'} tooth class</SheetTitle>
        </SheetHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Display name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Molar"
              disabled={!isAdmin}
            />
            {toothClass ? (
              <p className="text-xs text-muted-foreground">
                Code: <span className="font-mono">{toothClass.name}</span> (fixed)
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                The code is derived from this name and fixed once created — the label stays
                renameable.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>
              Sort order <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              type="number"
              step="1"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              placeholder="0"
              disabled={!isAdmin}
            />
            <p className="text-xs text-muted-foreground">
              Lower numbers show first in the pricing matrix.
            </p>
          </div>
          {toothClass && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive classes stay on existing prices but can't be picked for new ones.
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} disabled={!isAdmin} />
            </div>
          )}
        </div>
        <SheetFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !isAdmin}>
            {saving ? 'Saving…' : toothClass ? 'Save' : 'Create'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
