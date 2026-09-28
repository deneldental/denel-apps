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
import {
  createTreatmentType,
  deleteTreatmentType,
  getAllTreatmentTypes,
  updateTreatmentType,
} from '@/lib/actions/treatment-types'
import type { treatmentTypes } from '@/lib/db/schema'

type TreatmentType = typeof treatmentTypes.$inferSelect

export function TreatmentTypesSection() {
  const [typeList, setTypeList] = useState<TreatmentType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editingType, setEditingType] = useState<TreatmentType | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [typeToDelete, setTypeToDelete] = useState<TreatmentType | null>(null)
  const [formData, setFormData] = useState({ name: '', displayName: '' })

  const loadTypes = async () => {
    setIsLoading(true)
    const result = await getAllTreatmentTypes()
    if ('success' in result && result.data) {
      setTypeList(result.data)
    } else {
      toast.error((result as { error?: string }).error || 'Failed to load service categories')
    }
    setIsLoading(false)
  }

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const result = await getAllTreatmentTypes()
      if (mounted) {
        if ('success' in result && result.data) {
          setTypeList(result.data)
        } else {
          toast.error((result as { error?: string }).error || 'Failed to load service categories')
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
      toast.error('Category name is required')
      return
    }

    const result = editingType
      ? await updateTreatmentType(editingType.id, formData)
      : await createTreatmentType(formData)

    if (result.success) {
      toast.success(
        editingType
          ? 'Service category updated successfully'
          : 'Service category created successfully'
      )
      loadTypes()
      setShowDialog(false)
      setEditingType(null)
      setFormData({ name: '', displayName: '' })
    } else {
      toast.error(result.error || 'Failed to save service category')
    }
  }

  const handleDelete = async () => {
    if (!typeToDelete) return

    const result = await deleteTreatmentType(typeToDelete.id)
    if (result.success) {
      toast.success('Service category deleted successfully')
      loadTypes()
      setDeleteDialogOpen(false)
      setTypeToDelete(null)
    } else {
      toast.error(result.error || 'Failed to delete service category')
    }
  }

  const handleEdit = (type: TreatmentType) => {
    setEditingType(type)
    setFormData({
      name: type.name,
      displayName: type.displayName || '',
    })
    setShowDialog(true)
  }

  const handleAdd = () => {
    setEditingType(null)
    setFormData({ name: '', displayName: '' })
    setShowDialog(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Service Categories</CardTitle>
            <CardDescription>
              Manage service categories used to group priced services.
            </CardDescription>
          </div>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Category
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading service categories...</p>
          </div>
        ) : typeList.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No service categories found.</p>
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
              {typeList.map((type) => (
                <TableRow key={type.id}>
                  <TableCell className="font-medium capitalize">{type.name}</TableCell>
                  <TableCell>{type.displayName || type.name}</TableCell>
                  <TableCell>
                    <Badge variant={type.isActive ? 'default' : 'secondary'}>
                      {type.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(type)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setTypeToDelete(type)
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
            <DialogTitle>
              {editingType ? 'Edit Service Category' : 'Add Service Category'}
            </DialogTitle>
            <DialogDescription>
              {editingType ? 'Update service category details' : 'Add a new service category'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="type-name">Category Name *</Label>
              <Input
                id="type-name"
                placeholder="e.g., root canal therapy, scaling and polishing"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground">
                Short name (will be displayed in lowercase)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="type-display">Display Name</Label>
              <Input
                id="type-display"
                placeholder="e.g., Root Canal Therapy, Scaling and Polishing"
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
            <Button onClick={handleSave}>{editingType ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="Delete Service Category"
        description="Are you sure you want to delete this service category? This action cannot be undone."
        itemName={typeToDelete?.name}
      />
    </Card>
  )
}
