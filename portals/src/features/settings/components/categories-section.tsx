import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createCategory,
  deleteCategory,
  getAllCategories,
  updateCategory,
} from '@/lib/actions/categories'
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

type CategoryForm = { name: string }

export function CategoriesSection() {
  // Full list + CRUD for the `categories` lookup. Mutations invalidate
  // `queryKeys.settings.lookup('categories')`, which prefix-matches this
  // `…/all` list and every `useLookup('categories')` picker (inventory
  // sheets + columns) — so a change here shows up without a reload.
  const {
    rows: categoryList,
    isLoading,
    error: loadError,
    create: createCategoryM,
    update: updateCategoryM,
    remove: deleteCategoryM,
  } = useLookupAdmin<CategoryForm>('categories', {
    getAll: getAllCategories,
    create: createCategory,
    update: updateCategory,
    remove: deleteCategory,
  })

  const [showDialog, setShowDialog] = useState(false)
  const [editingCategory, setEditingCategory] = useState<LookupRow | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<LookupRow | null>(null)
  const [formData, setFormData] = useState({ name: '' })

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Category name is required')
      return
    }

    try {
      if (editingCategory) {
        await updateCategoryM.mutateAsync({ id: editingCategory.id, data: formData })
        toast.success('Category updated successfully')
      } else {
        await createCategoryM.mutateAsync(formData)
        toast.success('Category created successfully')
      }
      setShowDialog(false)
      setEditingCategory(null)
      setFormData({ name: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save category')
    }
  }

  const handleDelete = async () => {
    if (!categoryToDelete) return

    try {
      await deleteCategoryM.mutateAsync(categoryToDelete.id)
      toast.success('Category deleted successfully')
      setDeleteDialogOpen(false)
      setCategoryToDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete category')
    }
  }

  const handleEdit = (category: LookupRow) => {
    setEditingCategory(category)
    setFormData({ name: category.name })
    setShowDialog(true)
  }

  const handleAdd = () => {
    setEditingCategory(null)
    setFormData({ name: '' })
    setShowDialog(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Categories</CardTitle>
            <CardDescription>Manage product and inventory categories.</CardDescription>
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
            <p className="text-muted-foreground">Loading categories...</p>
          </div>
        ) : loadError ? (
          <div className="text-center py-8">
            <p className="text-destructive">{loadError || 'Failed to load categories'}</p>
          </div>
        ) : categoryList.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No categories found.</p>
            <Button onClick={handleAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Category
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoryList.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium capitalize">{category.name}</TableCell>
                  <TableCell>
                    <Badge variant={category.isActive ? 'default' : 'secondary'}>
                      {category.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(category)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCategoryToDelete(category)
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
            <DialogTitle>{editingCategory ? 'Edit Category' : 'Add Category'}</DialogTitle>
            <DialogDescription>
              {editingCategory ? 'Update category details' : 'Add a new category'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Category Name *</Label>
              <Input
                id="category-name"
                placeholder="e.g., medicine, supplies"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>{editingCategory ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="Delete Category"
        description="Are you sure you want to delete this category? This action cannot be undone."
        itemName={categoryToDelete?.name}
      />
    </Card>
  )
}
