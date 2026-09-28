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
  createAppointmentType,
  deleteAppointmentType,
  getAllAppointmentTypes,
  updateAppointmentType,
} from '@/lib/actions/appointment-types'
import type { appointmentTypes } from '@/lib/db/schema'

type AppointmentType = typeof appointmentTypes.$inferSelect

export function AppointmentTypesSection() {
  const [typeList, setTypeList] = useState<AppointmentType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editingType, setEditingType] = useState<AppointmentType | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [typeToDelete, setTypeToDelete] = useState<AppointmentType | null>(null)
  const [formData, setFormData] = useState({ name: '', displayName: '' })

  const loadTypes = async () => {
    setIsLoading(true)
    const result = await getAllAppointmentTypes()
    if ('success' in result && result.data) {
      setTypeList(result.data)
    } else {
      toast.error((result as { error?: string }).error || 'Failed to load appointment types')
    }
    setIsLoading(false)
  }

  useEffect(() => {
    let mounted = true
    const load = async () => {
      // setIsLoading is already true by default
      const result = await getAllAppointmentTypes()
      if (mounted) {
        if ('success' in result && result.data) {
          setTypeList(result.data)
        } else {
          toast.error((result as { error?: string }).error || 'Failed to load appointment types')
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
      toast.error('Appointment type name is required')
      return
    }

    const result = editingType
      ? await updateAppointmentType(editingType.id, formData)
      : await createAppointmentType(formData)

    if (result.success) {
      toast.success(
        editingType
          ? 'Appointment type updated successfully'
          : 'Appointment type created successfully'
      )
      loadTypes()
      setShowDialog(false)
      setEditingType(null)
      setFormData({ name: '', displayName: '' })
    } else {
      toast.error(result.error || 'Failed to save appointment type')
    }
  }

  const handleDelete = async () => {
    if (!typeToDelete) return

    const result = await deleteAppointmentType(typeToDelete.id)
    if (result.success) {
      toast.success('Appointment type deleted successfully')
      loadTypes()
      setDeleteDialogOpen(false)
      setTypeToDelete(null)
    } else {
      toast.error(result.error || 'Failed to delete appointment type')
    }
  }

  const handleEdit = (type: AppointmentType) => {
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
            <CardTitle>Appointment Types</CardTitle>
            <CardDescription>
              Manage appointment types used when scheduling appointments.
            </CardDescription>
          </div>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Type
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading appointment types...</p>
          </div>
        ) : typeList.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No appointment types found.</p>
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
              {editingType ? 'Edit Appointment Type' : 'Add Appointment Type'}
            </DialogTitle>
            <DialogDescription>
              {editingType ? 'Update appointment type details' : 'Add a new appointment type'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="type-name">Type Name *</Label>
              <Input
                id="type-name"
                placeholder="e.g., consultation, checkup"
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
                placeholder="e.g., Consultation, Checkup"
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
        title="Delete Appointment Type"
        description="Are you sure you want to delete this appointment type? This action cannot be undone."
        itemName={typeToDelete?.name}
      />
    </Card>
  )
}
