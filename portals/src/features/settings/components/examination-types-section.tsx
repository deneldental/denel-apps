import { toLookupSlug } from '@denel/utils'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
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
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

type ExaminationType = { id: string; name: string; displayName: string | null; isActive: boolean }

export function ExaminationTypesSection() {
  const [items, setItems] = useState<ExaminationType[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<ExaminationType | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExaminationType | null>(null)
  const [formData, setFormData] = useState({ name: '', displayName: '' })
  const [initialDisplayName, setInitialDisplayName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()

  const isDirty = useMemo(
    () => formData.displayName !== initialDisplayName,
    [formData.displayName, initialDisplayName]
  )

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => setShowDialog(false),
  })

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<ExaminationType[]>('/api/lookups/examination-types/all')
    if (res.success && res.data) setItems(res.data as ExaminationType[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function handleSave() {
    if (!formData.displayName.trim()) {
      toast.error('Display name is required')
      return
    }
    const derived = toLookupSlug(formData.displayName)
    if (!derived) {
      toast.error('Display name must contain at least one letter or digit')
      return
    }
    void submit(async () => {
      if (editing) {
        const res = await api.patch(`/api/lookups/examination-types/${editing.id}`, {
          displayName: formData.displayName.trim(),
        })
        if (res.success) {
          toast.success('Examination type updated')
          await load()
          setShowDialog(false)
        } else {
          surfaceApiError(res, 'Failed to update')
        }
      } else {
        const res = await api.post('/api/lookups/examination-types', {
          name: derived,
          displayName: formData.displayName.trim(),
        })
        if (res.success) {
          toast.success('Examination type created')
          await load()
          setShowDialog(false)
        } else {
          surfaceApiError(res, 'Failed to create')
        }
      }
    })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await api.patch(`/api/lookups/examination-types/${deleteTarget.id}`, {
        isActive: false,
      })
      if (res.success) {
        toast.success('Examination type deactivated')
        await load()
        setDeleteTarget(null)
      } else {
        surfaceApiError(res, 'Failed to deactivate')
      }
    } finally {
      setDeleting(false)
    }
  }

  function openAdd() {
    setEditing(null)
    setFormData({ name: '', displayName: '' })
    setInitialDisplayName('')
    setShowDialog(true)
  }

  function openEdit(item: ExaminationType) {
    setEditing(item)
    const display = item.displayName ?? item.name
    setFormData({ name: item.name, displayName: display })
    setInitialDisplayName(display)
    setShowDialog(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Examination Types</CardTitle>
            <CardDescription>Types of examinations used in clinical assessments.</CardDescription>
          </div>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Type
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No examination types configured.
          </p>
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
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium font-mono text-xs">{item.name}</TableCell>
                  <TableCell>{item.displayName ?? item.name}</TableCell>
                  <TableCell>
                    <Badge variant={item.isActive ? 'default' : 'secondary'}>
                      {item.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {item.isActive && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(item)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={showDialog} onOpenChange={guardedOnOpenChange}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSave()
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {editing ? 'Edit Examination Type' : 'Add Examination Type'}
              </DialogTitle>
              <DialogDescription>
                {editing
                  ? 'Update the display name for this type.'
                  : 'Create a new examination type.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="exam-display">Display Name *</Label>
                <Input
                  id="exam-display"
                  placeholder="e.g. Full Mouth X-ray, Periapical"
                  maxLength={100}
                  value={formData.displayName}
                  onChange={(e) => {
                    const display = e.target.value
                    setFormData({
                      displayName: display,
                      name: editing ? formData.name : toLookupSlug(display),
                    })
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {editing ? 'Internal name (fixed): ' : 'Internal name: '}
                  <span className="font-mono">
                    {editing ? editing.name : toLookupSlug(formData.displayName) || '...'}
                  </span>
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => guardedOnOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : editing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={handleDelete}
        title="Deactivate Examination Type"
        description="This will hide the type from the examination form. Existing records are unaffected."
        itemName={deleteTarget?.displayName ?? deleteTarget?.name}
        isLoading={deleting}
        confirmLabel="Deactivate"
        tone="default"
      />
    </Card>
  )
}
