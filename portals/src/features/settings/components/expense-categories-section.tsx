import { toLookupSlug } from '@denel/utils'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createExpenseCategory,
  deleteExpenseCategory,
  getAllExpenseCategories,
  updateExpenseCategory,
} from '@/lib/actions/expense-categories'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { type LookupRow, useLookupAdmin } from '@/shared/hooks/use-lookup'

type ExpenseCatRow = LookupRow & { pettyRefType?: string | null; isPettyCash?: boolean | null }
type ExpenseCatForm = {
  name: string
  displayName: string
  pettyRefType: string
  isPettyCash: boolean
}

export function ExpenseCategoriesSection() {
  // Full list + CRUD for the `expense-categories` lookup. Mutations invalidate
  // `queryKeys.settings.lookup('expense-categories')`, which prefix-matches this
  // `…/all` list and every `useLookup('expense-categories')` picker (expense
  // sheets, ledger adjustments, petty-cash settings) — no reload needed.
  const {
    rows: categoryList,
    isLoading,
    error: loadError,
    create: createCategoryM,
    update: updateCategoryM,
    remove: deleteCategoryM,
  } = useLookupAdmin<ExpenseCatForm, Partial<ExpenseCatForm>, ExpenseCatRow>('expense-categories', {
    getAll: getAllExpenseCategories,
    create: createExpenseCategory,
    update: updateExpenseCategory,
    remove: deleteExpenseCategory,
  })

  const [showDialog, setShowDialog] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ExpenseCatRow | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<ExpenseCatRow | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    pettyRefType: 'none',
    isPettyCash: false,
  })

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Expense category name is required')
      return
    }

    try {
      if (editingCategory) {
        await updateCategoryM.mutateAsync({
          id: editingCategory.id,
          data: {
            displayName: formData.displayName,
            pettyRefType: formData.pettyRefType,
            isPettyCash: formData.isPettyCash,
          },
        })
        toast.success('Expense category updated successfully')
      } else {
        await createCategoryM.mutateAsync(formData)
        toast.success('Expense category created successfully')
      }
      setShowDialog(false)
      setEditingCategory(null)
      setFormData({ name: '', displayName: '', pettyRefType: 'none', isPettyCash: false })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save expense category')
    }
  }

  const handleDelete = async () => {
    if (!categoryToDelete) return

    try {
      await deleteCategoryM.mutateAsync(categoryToDelete.id)
      toast.success('Expense category deleted successfully')
      setDeleteDialogOpen(false)
      setCategoryToDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete expense category')
    }
  }

  const handleEdit = (category: ExpenseCatRow) => {
    setEditingCategory(category)
    setFormData({
      name: category.name,
      displayName: category.displayName || category.name,
      pettyRefType: category.pettyRefType || 'none',
      isPettyCash: category.isPettyCash || false,
    })
    setShowDialog(true)
  }

  const handleAdd = () => {
    setEditingCategory(null)
    setFormData({ name: '', displayName: '', pettyRefType: 'none', isPettyCash: false })
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
        ) : loadError ? (
          <div className="text-center py-8">
            <p className="text-destructive">{loadError || 'Failed to load expense categories'}</p>
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
              <Label htmlFor="category-display">Display Name *</Label>
              <Input
                id="category-display"
                placeholder="e.g., Utilities, Office Supplies"
                value={formData.displayName}
                onChange={(e) => {
                  const display = e.target.value
                  setFormData((prev) => ({
                    ...prev,
                    displayName: display,
                    name: editingCategory ? prev.name : toLookupSlug(display),
                  }))
                }}
                required
              />
              <p className="text-xs text-muted-foreground">
                {editingCategory ? 'Internal name (fixed): ' : 'Type name auto-generated: '}
                <span className="font-mono">
                  {editingCategory
                    ? editingCategory.name
                    : toLookupSlug(formData.displayName) || '...'}
                </span>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-ref-type">Requires Selection Of</Label>
              <Select
                value={formData.pettyRefType}
                onValueChange={(value) => {
                  setFormData({
                    ...formData,
                    pettyRefType: value,
                    isPettyCash: value !== 'none',
                  })
                }}
              >
                <SelectTrigger id="category-ref-type">
                  <SelectValue placeholder="Select reference type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="specialist">Doctor (Specialist)</SelectItem>
                  <SelectItem value="service_provider">Service Provider</SelectItem>
                  <SelectItem value="staff">Staff (Errand)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                If selected, users must pick a specific person/provider when logging this expense.
              </p>
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
