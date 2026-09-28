import { toLookupSlug } from '@denel/utils'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createAppointmentType,
  deleteAppointmentType,
  getAllAppointmentTypes,
  updateAppointmentType,
} from '@/lib/actions/appointment-types'
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

type TypeForm = { name: string; displayName: string; colour: string }

export function AppointmentTypesSection() {
  // Full list + CRUD for the `appointment-types` lookup. Every mutation
  // invalidates `queryKeys.settings.lookup('appointment-types')`, which
  // prefix-matches this `…/all` list and every active-only picker (scheduling
  // calendar, booking dialogs) — so a change here shows up without a reload.
  const {
    rows: typeList,
    isLoading,
    error: loadError,
    create: createType,
    update: updateType,
    remove: deleteType,
  } = useLookupAdmin<TypeForm, Partial<TypeForm>>('appointment-types', {
    getAll: getAllAppointmentTypes,
    create: createAppointmentType,
    update: updateAppointmentType,
    remove: deleteAppointmentType,
  })

  const [showDialog, setShowDialog] = useState(false)
  const [editingType, setEditingType] = useState<LookupRow | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [typeToDelete, setTypeToDelete] = useState<LookupRow | null>(null)
  // Slate-400 matches the schema default — admins can override via the
  // colour picker. Kept as a hex string so it maps 1:1 to `<input type="color">`.
  const DEFAULT_COLOUR = '#94A3B8'
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    colour: DEFAULT_COLOUR,
  })

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Appointment type name is required')
      return
    }

    try {
      if (editingType) {
        await updateType.mutateAsync({
          id: editingType.id,
          data: { displayName: formData.displayName, colour: formData.colour },
        })
        toast.success('Appointment type updated successfully')
      } else {
        await createType.mutateAsync(formData)
        toast.success('Appointment type created successfully')
      }
      setShowDialog(false)
      setEditingType(null)
      setFormData({ name: '', displayName: '', colour: DEFAULT_COLOUR })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save appointment type')
    }
  }

  const handleDelete = async () => {
    if (!typeToDelete) return

    try {
      await deleteType.mutateAsync(typeToDelete.id)
      toast.success('Appointment type deleted successfully')
      setDeleteDialogOpen(false)
      setTypeToDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete appointment type')
    }
  }

  const handleEdit = (type: LookupRow) => {
    setEditingType(type)
    setFormData({
      name: type.name,
      displayName: type.displayName || type.name,
      colour: type.colour || DEFAULT_COLOUR,
    })
    setShowDialog(true)
  }

  const handleAdd = () => {
    setEditingType(null)
    setFormData({ name: '', displayName: '', colour: DEFAULT_COLOUR })
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
        ) : loadError ? (
          <div className="text-center py-8">
            <p className="text-destructive">{loadError || 'Failed to load appointment types'}</p>
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
                <TableHead>Colour</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {typeList.map((type) => {
                const rowColour = type.colour || DEFAULT_COLOUR
                return (
                  <TableRow key={type.id}>
                    <TableCell className="font-medium capitalize">{type.name}</TableCell>
                    <TableCell>{type.displayName || type.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-4 w-4 rounded border"
                          style={{ backgroundColor: rowColour }}
                          title={`Colour ${rowColour}`}
                        />
                        <span className="font-mono text-xs text-muted-foreground">{rowColour}</span>
                      </div>
                    </TableCell>
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
              {editingType ? 'Edit Appointment Type' : 'Add Appointment Type'}
            </DialogTitle>
            <DialogDescription>
              {editingType ? 'Update appointment type details' : 'Add a new appointment type'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="type-display">Display Name *</Label>
              <Input
                id="type-display"
                placeholder="e.g., Consultation, Follow-up"
                value={formData.displayName}
                onChange={(e) => {
                  const display = e.target.value
                  setFormData((prev) => ({
                    ...prev,
                    displayName: display,
                    name: editingType ? prev.name : toLookupSlug(display),
                  }))
                }}
                required
              />
              <p className="text-xs text-muted-foreground">
                {editingType ? 'Internal name (fixed): ' : 'Type name auto-generated: '}
                <span className="font-mono">
                  {editingType ? editingType.name : toLookupSlug(formData.displayName) || '...'}
                </span>
              </p>
            </div>

            {/* Calendar colour — native <input type="color"> so admins get
                the OS picker. The hex value is stored directly on the
                appointment type and consumed by the scheduling calendar. */}
            <div className="space-y-2">
              <Label htmlFor="type-colour">Calendar Colour</Label>
              <div className="flex items-center gap-3">
                <input
                  id="type-colour"
                  type="color"
                  value={formData.colour}
                  onChange={(e) => setFormData((prev) => ({ ...prev, colour: e.target.value }))}
                  className="h-9 w-14 cursor-pointer rounded border border-input bg-transparent p-1"
                  aria-label="Pick a calendar colour"
                />
                <Input
                  value={formData.colour}
                  onChange={(e) => setFormData((prev) => ({ ...prev, colour: e.target.value }))}
                  pattern="^#[0-9A-Fa-f]{6}$"
                  placeholder="#94A3B8"
                  className="font-mono w-32"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Used to tint appointments of this type on the scheduling calendar.
              </p>
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
