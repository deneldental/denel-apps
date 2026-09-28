import { toLookupSlug } from '@denel/utils'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createPaymentMethod,
  deletePaymentMethod,
  getAllPaymentMethods,
  updatePaymentMethod,
} from '@/lib/actions/payment-methods'
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

type PaymentMethodRow = LookupRow & { glAccountCode: string | null }

// Fixed list of GL cash/bank/clearing channels a payment method can post to.
// Keyed to the codes `backend/src/lib/channel-accounts.ts` (`METHOD_TO_CODE`)
// already knows — this is deliberately NOT a free Chart-of-Accounts picker.
// Persisted as `glAccountCode`; `resolveChannelAccountId()` reads it first,
// before falling back to the canonical-slug map.
const GL_CHANNELS = [
  { label: 'Cash on Hand', code: '1000' },
  { label: 'Bank', code: '1010' },
  { label: 'Mobile Money', code: '1020' },
  { label: 'Card / POS', code: '1030' },
  { label: 'Insurance / Claims Receivable', code: '1210' },
  { label: 'Patient Deposits (wallet)', code: '2200' },
] as const

const channelLabel = (code: string | null | undefined) =>
  GL_CHANNELS.find((c) => c.code === code)?.label ?? null

export function PaymentMethodsSection() {
  const [showDialog, setShowDialog] = useState(false)
  const [editingMethod, setEditingMethod] = useState<PaymentMethodRow | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [methodToDelete, setMethodToDelete] = useState<PaymentMethodRow | null>(null)
  const [formData, setFormData] = useState({ name: '', displayName: '', glAccountCode: '' })

  // Sharing `queryKeys.settings.lookup('payment-methods')` with usePaymentMethods()
  // means every create/update/delete here refreshes every open
  // <PaymentMethodSelect> too — no manual invalidation needed.
  const {
    rows: methodList,
    isLoading,
    create: createMutation,
    update: updateMutation,
    remove: deleteMutation,
  } = useLookupAdmin<
    { name: string; displayName?: string; glAccountCode?: string | null },
    { displayName?: string; glAccountCode?: string | null },
    PaymentMethodRow
  >('payment-methods', {
    getAll: getAllPaymentMethods,
    create: createPaymentMethod,
    update: updatePaymentMethod,
    remove: deletePaymentMethod,
  })

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Payment method name is required')
      return
    }
    if (!formData.glAccountCode) {
      toast.error('Choose which GL channel this method posts to')
      return
    }

    try {
      if (editingMethod) {
        await updateMutation.mutateAsync({
          id: editingMethod.id,
          data: { displayName: formData.displayName, glAccountCode: formData.glAccountCode },
        })
        toast.success('Payment method updated successfully')
      } else {
        await createMutation.mutateAsync({
          name: formData.name,
          displayName: formData.displayName,
          glAccountCode: formData.glAccountCode,
        })
        toast.success('Payment method created successfully')
      }
      setShowDialog(false)
      setEditingMethod(null)
      setFormData({ name: '', displayName: '', glAccountCode: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save payment method')
    }
  }

  const handleDelete = async () => {
    if (!methodToDelete) return
    try {
      await deleteMutation.mutateAsync(methodToDelete.id)
      toast.success('Payment method deleted successfully')
      setDeleteDialogOpen(false)
      setMethodToDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete payment method')
    }
  }

  const handleEdit = (method: PaymentMethodRow) => {
    setEditingMethod(method)
    setFormData({
      name: method.name,
      displayName: method.displayName || method.name,
      glAccountCode: method.glAccountCode || '',
    })
    setShowDialog(true)
  }

  const handleAdd = () => {
    setEditingMethod(null)
    setFormData({ name: '', displayName: '', glAccountCode: '' })
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
                <TableHead>Posts To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {methodList.map((method) => {
                const posts = channelLabel(method.glAccountCode)
                return (
                  <TableRow key={method.id}>
                    <TableCell className="font-medium capitalize">
                      {method.name.replace('_', ' ')}
                    </TableCell>
                    <TableCell>{method.displayName || method.name.replace('_', ' ')}</TableCell>
                    <TableCell>
                      {posts ? (
                        <span className="text-sm">
                          {posts}{' '}
                          <span className="font-mono text-xs text-muted-foreground">
                            {method.glAccountCode}
                          </span>
                        </span>
                      ) : (
                        <Badge variant="secondary">Not set</Badge>
                      )}
                    </TableCell>
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
                )
              })}
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
              <Label htmlFor="method-display">Display Name *</Label>
              <Input
                id="method-display"
                placeholder="e.g., Mobile Money, Bank Transfer"
                value={formData.displayName}
                onChange={(e) => {
                  const display = e.target.value
                  setFormData({
                    ...formData,
                    displayName: display,
                    name: editingMethod ? formData.name : toLookupSlug(display),
                  })
                }}
                required
              />
              <p className="text-xs text-muted-foreground">
                {editingMethod ? 'Internal name (fixed): ' : 'Type name auto-generated: '}
                <span className="font-mono">
                  {editingMethod ? editingMethod.name : toLookupSlug(formData.displayName) || '...'}
                </span>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="method-gl-channel">Posts To *</Label>
              <Select
                value={formData.glAccountCode}
                onValueChange={(value) => setFormData({ ...formData, glAccountCode: value })}
              >
                <SelectTrigger id="method-gl-channel">
                  <SelectValue placeholder="Select a GL channel" />
                </SelectTrigger>
                <SelectContent>
                  {GL_CHANNELS.map((channel) => (
                    <SelectItem key={channel.code} value={channel.code}>
                      {channel.label} ({channel.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The cash / bank / clearing account this method's receipts post to in the ledger.
              </p>
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
