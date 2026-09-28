import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmationDialog } from '@/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { createUnit, deleteUnit, getAllUnits, updateUnit } from '@/lib/actions/units'
import type { units } from '@/lib/db/schema'

type Unit = typeof units.$inferSelect

export function UnitsSection() {
  const [unitList, setUnitList] = useState<Unit[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [unitToDelete, setUnitToDelete] = useState<Unit | null>(null)
  const [formData, setFormData] = useState({ name: '', displayName: '' })

  const loadUnits = async () => {
    setIsLoading(true)
    const result = await getAllUnits()
    if ('success' in result && result.data) {
      setUnitList(result.data)
    } else {
      toast.error((result as { error?: string }).error || 'Failed to load units')
    }
    setIsLoading(false)
  }

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const result = await getAllUnits()
      if (mounted) {
        if ('success' in result && result.data) {
          setUnitList(result.data)
        } else {
          toast.error((result as { error?: string }).error || 'Failed to load units')
        }
        setIsLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Unit name is required')
      return
    }

    const result = editingUnit
      ? await updateUnit(editingUnit.id, formData)
      : await createUnit(formData)

    if (result.success) {
      toast.success(editingUnit ? 'Unit updated successfully' : 'Unit created successfully')
      loadUnits()
      setShowDialog(false)
      setEditingUnit(null)
      setFormData({ name: '', displayName: '' })
    } else {
      toast.error(result.error || 'Failed to save unit')
    }
  }

  const handleDelete = async () => {
    if (!unitToDelete) return

    const result = await deleteUnit(unitToDelete.id)
    if (result.success) {
      toast.success('Unit deleted successfully')
      loadUnits()
      setDeleteDialogOpen(false)
      setUnitToDelete(null)
    } else {
      toast.error(result.error || 'Failed to delete unit')
    }
  }

  const handleEdit = (unit: Unit) => {
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
              <Label htmlFor="unit-name">Unit Name *</Label>
              <Input
                id="unit-name"
                placeholder="e.g., pcs, kg, liter"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground">
                Short name (will be displayed in uppercase)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit-display">Display Name</Label>
              <Input
                id="unit-display"
                placeholder="e.g., Pieces (pcs)"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Optional friendly display name</p>
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
