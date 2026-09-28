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
  createPaymentMethod,
  deletePaymentMethod,
  getAllPaymentMethods,
  updatePaymentMethod,
} from '@/lib/actions/payment-methods'
import type { paymentMethods } from '@/lib/db/schema'

type PaymentMethod = typeof paymentMethods.$inferSelect

export function PaymentMethodsSection() {
  const [methodList, setMethodList] = useState<PaymentMethod[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [methodToDelete, setMethodToDelete] = useState<PaymentMethod | null>(null)
  const [formData, setFormData] = useState({ name: '', displayName: '' })

  const loadMethods = async () => {
    setIsLoading(true)
    const result = await getAllPaymentMethods()
    if ('success' in result && result.data) {
      setMethodList(result.data)
    } else {
      toast.error((result as { error?: string }).error || 'Failed to load payment methods')
    }
    setIsLoading(false)
  }

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const result = await getAllPaymentMethods()
      if (mounted) {
        if ('success' in result && result.data) {
          setMethodList(result.data)
        } else {
          toast.error((result as { error?: string }).error || 'Failed to load payment methods')
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
      toast.error('Payment method name is required')
      return
    }

    const result = editingMethod
      ? await updatePaymentMethod(editingMethod.id, formData)
      : await createPaymentMethod(formData)

    if (result.success) {
      toast.success(
        editingMethod
          ? 'Payment method updated successfully'
          : 'Payment method created successfully'
      )
      loadMethods()
      setShowDialog(false)
      setEditingMethod(null)
      setFormData({ name: '', displayName: '' })
    } else {
      toast.error(result.error || 'Failed to save payment method')
    }
  }

  const handleDelete = async () => {
    if (!methodToDelete) return

    const result = await deletePaymentMethod(methodToDelete.id)
    if (result.success) {
      toast.success('Payment method deleted successfully')
      loadMethods()
      setDeleteDialogOpen(false)
      setMethodToDelete(null)
    } else {
      toast.error(result.error || 'Failed to delete payment method')
    }
  }

  const handleEdit = (method: PaymentMethod) => {
    setEditingMethod(method)
    setFormData({
      name: method.name,
      displayName: method.displayName || '',
    })
    setShowDialog(true)
  }

  const handleAdd = () => {
    setEditingMethod(null)
    setFormData({ name: '', displayName: '' })
    setShowDialog(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Payment Methods</CardTitle>
            <CardDescription>
              Manage payment methods used throughout the application (payments, expenses, etc.).
            </CardDescription>
          </div>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Method
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading payment methods...</p>
          </div>
        ) : methodList.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No payment methods found.</p>
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
              {methodList.map((method) => (
                <TableRow key={method.id}>
                  <TableCell className="font-medium capitalize">
                    {method.name.replace('_', ' ')}
                  </TableCell>
                  <TableCell>{method.displayName || method.name.replace('_', ' ')}</TableCell>
                  <TableCell>
                    <Badge variant={method.isActive ? 'default' : 'secondary'}>
                      {method.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(method)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setMethodToDelete(method)
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
              {editingMethod ? 'Edit Payment Method' : 'Add Payment Method'}
            </DialogTitle>
            <DialogDescription>
              {editingMethod ? 'Update payment method details' : 'Add a new payment method'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="method-name">Method Name *</Label>
              <Input
                id="method-name"
                placeholder="e.g., cash, momo, bank_transfer"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground">
                Short name (will be displayed in lowercase)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="method-display">Display Name</Label>
              <Input
                id="method-display"
                placeholder="e.g., Cash, MoMo, Bank Transfer"
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
            <Button onClick={handleSave}>{editingMethod ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="Delete Payment Method"
        description="Are you sure you want to delete this payment method? This action cannot be undone."
        itemName={methodToDelete?.name}
      />
    </Card>
  )
}
