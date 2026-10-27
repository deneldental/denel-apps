import { Loader2, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  type ApplicationScope,
  createApplicationScope,
  deleteApplicationScope,
  getApplicationScopes,
  restoreApplicationScope,
  updateApplicationScope,
} from '@/lib/actions/services'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Switch } from '@/shared/components/ui/switch'
import { useConfirm } from '@/shared/hooks/use-confirm'

/**
 * Application-type (scope) management tab — replaces the old service "Categories"
 * tab. An application type is the anatomical unit a service bills against
 * (whole mouth / arch / quadrant / tooth / surface / session / unit). Admins add
 * and edit them here; the service form's "Application type" picker reads them.
 */
export function ApplicationScopeTab({ isAdmin }: { isAdmin: boolean }) {
  const { confirm, confirmDialog } = useConfirm()
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<ApplicationScope | 'new' | null>(null)

  const SCOPES_KEY = queryKeys.services.scopes(true, showRetired)
  const scopesQuery = useApiQuery<ApplicationScope[]>(SCOPES_KEY, () =>
    getApplicationScopes(true, showRetired)
  )
  const scopes = scopesQuery.data ?? []
  const loading = scopesQuery.isLoading

  const restoreMutation = useApiMutation((id: string) => restoreApplicationScope(id), {
    invalidates: [queryKeys.services.all],
  })
  const deleteMutation = useApiMutation((id: string) => deleteApplicationScope(id), {
    invalidates: [queryKeys.services.all],
  })
  const updateMutation = useApiMutation(
    (vars: { id: string; data: Partial<ApplicationScope> }) =>
      updateApplicationScope(vars.id, vars.data),
    { invalidates: [queryKeys.services.all] }
  )

  async function handleRestore(s: ApplicationScope) {
    try {
      await restoreMutation.mutateAsync(s.id)
      // Comes back INACTIVE — re-offering it is a separate, deliberate step.
      toast.success(`"${s.displayName || s.name}" restored (inactive).`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore application type')
    }
  }

  async function handleDelete(s: ApplicationScope) {
    const ok = await confirm({
      title: 'Delete application type',
      description:
        'It is retired from the pricing matrix and every picker. This is refused if a service that bills against it has already been invoiced.',
      itemName: s.displayName || s.name,
    })
    if (!ok) return

    try {
      await deleteMutation.mutateAsync(s.id)
      toast.success(`"${s.displayName || s.name}" deleted.`)
    } catch (err) {
      // A 409 carries the real reason — show it verbatim.
      toast.error(err instanceof Error ? err.message : 'Failed to delete application type')
    }
  }

  async function toggleActive(s: ApplicationScope, isActive: boolean) {
    try {
      await updateMutation.mutateAsync({ id: s.id, data: { isActive } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Application types</p>
          <p className="text-xs text-muted-foreground">
            The unit a service bills against — used by the pricing matrix + checkout quantity.
          </p>
        </div>
        {/* Authoring application types is admin-only — hidden, not disabled, for
            everyone else so the tab reads as a plain reference list. */}
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
              New application type
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : scopes.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No application types yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Quantity</th>
                <th className="px-3 py-2 text-right">Max</th>
                <th className="px-3 py-2 text-center">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {scopes.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-3 py-2 font-medium">
                    <span className={s.deletedAt ? 'text-muted-foreground line-through' : ''}>
                      {s.displayName}
                    </span>
                    {s.deletedAt && (
                      <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">
                        Retired
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{s.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px]">
                        {s.quantityMode === 'multi' ? 'Multi (qty)' : 'Single'}
                      </Badge>
                      {s.additionalUnitPriceEnabled && (
                        <Badge variant="secondary" className="text-[10px]">
                          Stepped
                        </Badge>
                      )}
                      {s.variantType !== 'none' && (
                        <Badge variant="secondary" className="text-[10px]">
                          {s.variantType === 'tooth_class' ? 'By class' : 'Variants'}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.maxQuantity ?? '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <Switch
                      checked={s.isActive}
                      onCheckedChange={(v) => toggleActive(s, v)}
                      disabled={!isAdmin}
                      aria-label="Active"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isAdmin &&
                      (s.deletedAt ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleRestore(s)}
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
                            onClick={() => setEditing(s)}
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(s)}
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
        <ScopeFormSheet
          scope={editing === 'new' ? null : editing}
          isAdmin={isAdmin}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {confirmDialog}
    </div>
  )
}

function ScopeFormSheet({
  scope,
  isAdmin,
  onClose,
  onSaved,
}: {
  scope: ApplicationScope | null
  isAdmin: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [displayName, setDisplayName] = useState(scope?.displayName ?? '')
  const [quantityMode, setQuantityMode] = useState<'single' | 'multi'>(
    scope?.quantityMode ?? 'single'
  )
  const [variantType, setVariantType] = useState<'none' | 'plain' | 'tooth_class'>(
    scope?.variantType ?? 'none'
  )
  const [maxQuantity, setMaxQuantity] = useState(
    scope?.maxQuantity != null ? String(scope.maxQuantity) : ''
  )
  const [additionalUnitPriceEnabled, setAdditionalUnitPriceEnabled] = useState(
    scope?.additionalUnitPriceEnabled ?? false
  )

  const saveMutation = useApiMutation(
    (payload: {
      displayName: string
      quantityMode: 'single' | 'multi'
      variantType: 'none' | 'plain' | 'tooth_class'
      maxQuantity: number | null
      additionalUnitPriceEnabled: boolean
    }) =>
      scope
        ? updateApplicationScope(scope.id, payload)
        : createApplicationScope({ ...payload, name: payload.displayName }),
    { invalidates: [queryKeys.services.all] }
  )
  const saving = saveMutation.isPending

  async function save() {
    if (!displayName.trim()) {
      toast.error('A name is required.')
      return
    }
    const payload = {
      displayName: displayName.trim(),
      quantityMode,
      variantType,
      maxQuantity: quantityMode === 'multi' && maxQuantity.trim() ? Number(maxQuantity) : null,
      // A type billed once has no further units to price differently.
      additionalUnitPriceEnabled: quantityMode === 'multi' && additionalUnitPriceEnabled,
    }
    try {
      await saveMutation.mutateAsync(payload)
      toast.success(scope ? 'Application type updated.' : 'Application type created.')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save application type')
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="!w-full overflow-y-auto sm:!max-w-[480px]">
        <SheetHeader className="mb-2">
          <SheetTitle>{scope ? 'Edit' : 'New'} application type</SheetTitle>
        </SheetHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Display name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Per tooth"
              disabled={!isAdmin}
            />
            {scope && (
              <p className="text-xs text-muted-foreground">
                Code: <span className="font-mono">{scope.name}</span> (fixed)
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Quantity mode</Label>
            <Select
              value={quantityMode}
              onValueChange={(v) => setQuantityMode(v as 'single' | 'multi')}
              disabled={!isAdmin}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single — always bills one</SelectItem>
                <SelectItem value="multi">Multi — enter a quantity at checkout</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              "Multi" lets reception bill a quantity (e.g. per tooth); "single" always bills one
              (e.g. whole mouth, session).
            </p>
          </div>
          <div className="space-y-2">
            <Label>Variants</Label>
            <Select
              value={variantType}
              onValueChange={(v) => setVariantType(v as 'none' | 'plain' | 'tooth_class')}
              disabled={!isAdmin}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None — single price</SelectItem>
                <SelectItem value="plain">
                  Plain — named variants (e.g. sizes, bridge units)
                </SelectItem>
                <SelectItem value="tooth_class">
                  By tooth class — variants priced per molar/premolar/…
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Whether services of this type can define priced variants. Bridges use "Plain" (2-unit,
              3-unit, arch…); per-tooth work uses "By tooth class".
            </p>
          </div>
          {quantityMode === 'multi' && (
            <div className="space-y-2">
              <Label>
                Max quantity <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={maxQuantity}
                onChange={(e) => setMaxQuantity(e.target.value)}
                placeholder="e.g. 32"
                disabled={!isAdmin}
              />
            </div>
          )}
          {quantityMode === 'multi' && (
            <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="scope-additional-unit-price">
                  Price additional units differently
                </Label>
                <p className="text-xs text-muted-foreground">
                  A service of this type is billed its price for the first unit, and its own
                  "additional unit price" (set on the service's Price matrix step) for each unit
                  after that. Services with no additional unit price are billed the full price for
                  every unit.
                </p>
              </div>
              <Switch
                id="scope-additional-unit-price"
                checked={additionalUnitPriceEnabled}
                onCheckedChange={setAdditionalUnitPriceEnabled}
                disabled={!isAdmin}
              />
            </div>
          )}
        </div>
        <SheetFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !isAdmin}>
            {saving ? 'Saving…' : scope ? 'Save' : 'Create'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
