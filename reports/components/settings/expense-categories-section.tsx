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
  createExpenseCategory,
  deleteExpenseCategory,
  getAllExpenseCategories,
  updateExpenseCategory,
} from '@/lib/actions/expense-categories'
import type { expenseCategories } from '@/lib/db/schema'

type ExpenseCategory = typeof expenseCategories.$inferSelect

export function ExpenseCategoriesSection() {
  const [categoryList, setCategoryList] = useState<ExpenseCategory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<ExpenseCategory | null>(null)
  const [formData, setFormData] = useState({ name: '', displayName: '' })

  const loadCategories = async () => {
    setIsLoading(true)
    const result = await getAllExpenseCategories()
    if ('success' in result && result.data) {
      setCategoryList(result.data)
    } else {
      toast.error((result as { error?: string }).error || 'Failed to load expense categories')
    }
    setIsLoading(false)
  }

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const result = await getAllExpenseCategories()
      if (mounted) {
        if ('success' in result && result.data) {
          setCategoryList(result.data)
        } else {
          toast.error((result as { error?: string }).error || 'Failed to load expense categories')
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
      toast.error('Expense category name is required')
      return
    }

    const result = editingCategory
      ? await updateExpenseCategory(editingCategory.id, formData)
      : await createExpenseCategory(formData)

    if (result.success) {
      toast.success(
        editingCategory
          ? 'Expense category updated successfully'
          : 'Expense category created successfully'
      )
      loadCategories()
      setShowDialog(false)
      setEditingCategory(null)
      setFormData({ name: '', displayName: '' })
    } else {
      toast.error(result.error || 'Failed to save expense category')
    }
  }

  const handleDelete = async () => {
    if (!categoryToDelete) return

    const result = await deleteExpenseCategory(categoryToDelete.id)
    if (result.success) {
      toast.success('Expense category deleted successfully')
      loadCategories()
      setDeleteDialogOpen(false)
      setCategoryToDelete(null)
    } else {
      toast.error(result.error || 'Failed to delete expense category')
    }
  }

  const handleEdit = (category: ExpenseCategory) => {
    setEditingCategory(category)
    setFormData({
      name: category.name,
      displayName: category.displayName || '',
    })
    setShowDialog(true)
  }

  const handleAdd = () => {
    setEditingCategory(null)
    setFormData({ name: '', displayName: '' })
    setShowDialog(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Expense Categories</CardTitle>
            <CardDescription>
              Manage expense categories used when recording expenses.
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
            <p className="text-muted-foreground">Loading expense categories...</p>
          </div>
        ) : categoryList.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No expense categories found.</p>
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
              {categoryList.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium capitalize">{category.name}</TableCell>
                  <TableCell>{category.displayName || category.name}</TableCell>
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
            <DialogTitle>
              {editingCategory ? 'Edit Expense Category' : 'Add Expense Category'}
            </DialogTitle>
            <DialogDescription>
              {editingCategory ? 'Update expense category details' : 'Add a new expense category'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Category Name *</Label>
              <Input
                id="category-name"
                placeholder="e.g., utilities, rent"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground">
                Short name (will be displayed in lowercase)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-display">Display Name</Label>
              <Input
                id="category-display"
                placeholder="e.g., Utilities, Rent"
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
            <Button onClick={handleSave}>{editingCategory ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="Delete Expense Category"
        description="Are you sure you want to delete this expense category? This action cannot be undone."
        itemName={categoryToDelete?.name}
      />
    </Card>
  )
}
