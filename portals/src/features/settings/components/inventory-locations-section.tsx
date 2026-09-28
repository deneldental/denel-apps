import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createInventoryLocation,
  deleteInventoryLocation,
  type InventoryLocation,
  updateInventoryLocation,
} from '@/lib/actions/inventory-locations'
import { useApiMutation } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'
import {
  INVENTORY_LOCATIONS_KEY,
  useInventoryLocations,
} from '@/shared/hooks/use-inventory-locations'

const toCode = (s: string) =>
  s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.slice(0, 4))
    .join('-')
    .slice(0, 12)

interface LocationForm {
  name: string
  code: string
  description: string
}

const EMPTY_FORM: LocationForm = { name: '', code: '', description: '' }

export function InventoryLocationsSection() {
  const { locations, isLoading: loading } = useInventoryLocations()
  const invalidates = [INVENTORY_LOCATIONS_KEY]
  const createMutation = useApiMutation(createInventoryLocation, { invalidates })
  const updateMutation = useApiMutation(
    (vars: { id: string; data: Parameters<typeof updateInventoryLocation>[1] }) =>
      updateInventoryLocation(vars.id, vars.data),
    { invalidates }
  )
  const deleteMutation = useApiMutation((id: string) => deleteInventoryLocation(id), {
    invalidates,
  })

  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<InventoryLocation | null>(null)
  const [form, setForm] = useState<LocationForm>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<InventoryLocation | null>(null)

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowDialog(true)
  }

  function openEdit(loc: InventoryLocation) {
    setEditing(loc)
    setForm({
      name: loc.name,
      code: loc.code,
      description: loc.description ?? '',
    })
    setShowDialog(true)
  }

  function handleNameChange(value: string) {
    setForm((f) => ({
      ...f,
      name: value,
      code: toCode(value),
    }))
  }

  function handleCodeChange(value: string) {
    setForm((f) => ({ ...f, code: value.toUpperCase() }))
  }

  async function handleSave() {
    const name = form.name.trim()
    const code = form.code.trim().toUpperCase()
    const description = form.description.trim() || null

    if (!name) {
      toast.error('Location name is required')
      return
    }
    if (!code) {
      toast.error('Location code is required')
      return
    }

    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, data: { name, code, description } })
        toast.success('Location updated')
      } else {
        await createMutation.mutateAsync({ name, code, description })
        toast.success('Location created')
      }
      setShowDialog(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save location')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success('Location deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete location')
    }
    setDeleteTarget(null)
  }

  async function toggleActive(loc: InventoryLocation) {
    try {
      await updateMutation.mutateAsync({ id: loc.id, data: { isActive: !loc.isActive } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update location')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <CardTitle>Inventory Locations</CardTitle>
            <CardDescription>
              Physical locations where inventory items are stored (e.g. Main Storage, Operatory
              cabinets, Sterilization Room).
            </CardDescription>
          </div>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Location
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : locations.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No inventory locations yet. Add one to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((loc) => (
                <TableRow key={loc.id}>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{loc.name}</div>
                        {loc.description && (
                          <div className="text-xs text-muted-foreground">{loc.description}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{loc.code}</code>
                  </TableCell>
                  <TableCell>
                    <button type="button" onClick={() => toggleActive(loc)}>
                      <Badge variant={loc.isActive ? 'default' : 'secondary'}>
                        {loc.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(loc)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(loc)}
                        title="Delete location"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Location' : 'Add Location'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="loc-name">Name</Label>
              <Input
                id="loc-name"
                placeholder="e.g. Front Desk Storage"
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-desc">Description (optional)</Label>
              <Textarea
                id="loc-desc"
                placeholder="What's stored here?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Inventory Location"
        description="This will remove the location from the picker. Past inventory movements that referenced it will keep the historical label."
        itemName={deleteTarget?.name}
      />
    </Card>
  )
}
