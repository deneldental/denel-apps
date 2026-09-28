import { toLookupSlug } from '@denel/utils'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { createUnit, deleteUnit, getAllUnits, updateUnit } from '@/lib/actions/units'
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
  DialogDescription,
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
import { type LookupRow, useLookupAdmin } from '@/shared/hooks/use-lookup'

type UnitForm = { name: string; displayName: string }

export function UnitsSection() {
  // Full list + CRUD for the `units` lookup. Mutations invalidate
  // `queryKeys.settings.lookup('units')`, which prefix-matches this `…/all`
  // list and every `useLookup('units')` picker (inventory + product sheets) —
  // so a change here shows up without a reload.
  const {
    rows: unitList,
    isLoading,
    error: loadError,
    create: createUnitM,
    update: updateUnitM,
    remove: deleteUnitM,
  } = useLookupAdmin<UnitForm, Partial<UnitForm>>('units', {
    getAll: getAllUnits,
    create: createUnit,
    update: updateUnit,
    remove: deleteUnit,
  })

  const [showDialog, setShowDialog] = useState(false)
  const [editingUnit, setEditingUnit] = useState<LookupRow | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [unitToDelete, setUnitToDelete] = useState<LookupRow | null>(null)
  const [formData, setFormData] = useState({ name: '', displayName: '' })

  const handleSave = async () => {
    if (!formData.displayName.trim()) {
      toast.error('Display name is required')
      return
    }

    try {
      if (editingUnit) {
        await updateUnitM.mutateAsync({
          id: editingUnit.id,
          data: { displayName: formData.displayName },
        })
        toast.success('Unit updated successfully')
      } else {
        await createUnitM.mutateAsync(formData)
        toast.success('Unit created successfully')
      }
      setShowDialog(false)
      setEditingUnit(null)
      setFormData({ name: '', displayName: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save unit')
    }
  }

  const handleDelete = async () => {
    if (!unitToDelete) return

    try {
      await deleteUnitM.mutateAsync(unitToDelete.id)
      toast.success('Unit deleted successfully')
      setDeleteDialogOpen(false)
      setUnitToDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete unit')
    }
  }

  const handleEdit = (unit: LookupRow) => {
    setEditingUnit(unit)
    setFormData({
      name: unit.name,
      displayName: unit.displayName || '',
    })
    setShowDialog(true)
  }

  const handleAdd = () => {
    setEditingUnit(null)
    setFormData({ name: '', displayName: '' })
    setShowDialog(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Units</CardTitle>
            <CardDescription>
              Manage units of measurement used in inventory and products.
            </CardDescription>
          </div>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Unit
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading units...</p>
          </div>
        ) : loadError ? (
          <div className="text-center py-8">
            <p className="text-destructive">{loadError || 'Failed to load units'}</p>
          </div>
        ) : unitList.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No units found.</p>
            <Button onClick={handleAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Unit
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unitList.map((unit) => (
                <TableRow key={unit.id}>
                  <TableCell className="font-medium uppercase">{unit.name}</TableCell>
                  <TableCell>{unit.displayName || unit.name}</TableCell>
                  <TableCell>
                    <Badge variant={unit.isActive ? 'default' : 'secondary'}>
                      {unit.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(unit)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUnitToDelete(unit)
                          setDeleteDialogOpen(true)
                        }}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUnit ? 'Edit Unit' : 'Add Unit'}</DialogTitle>
            <DialogDescription>
              {editingUnit ? 'Update unit details' : 'Add a new unit of measurement'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="unit-display">Display Name *</Label>
              <Input
                id="unit-display"
                placeholder="e.g., Pieces (pcs)"
                value={formData.displayName}
                onChange={(e) => {
                  const val = e.target.value
                  setFormData({
                    ...formData,
                    displayName: val,
                    // The slug is fixed once created; only new units derive it.
                    name: editingUnit ? formData.name : toLookupSlug(val),
                  })
                }}
                required
              />
              <p className="text-xs text-muted-foreground">The friendly name of this unit</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>{editingUnit ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="Delete Unit"
        description="Are you sure you want to delete this unit? This action cannot be undone."
        itemName={unitToDelete?.name}
      />
    </Card>
  )
}
