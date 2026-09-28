import { toLookupSlug } from '@denel/utils'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createXrayType,
  deleteXrayType,
  getXrayTypes,
  updateXrayType,
} from '@/lib/actions/xray-types'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
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
import { Textarea } from '@/shared/components/ui/textarea'

type XrayType = {
  id: string
  name: string
  displayName: string
  description?: string | null
  active: boolean
}

const XRAY_TYPES_KEY = queryKeys.settings.lookup('xray-types')

export function XrayTypesSection() {
  const typesQuery = useApiQuery<XrayType[]>(XRAY_TYPES_KEY, getXrayTypes)
  const types = typesQuery.data ?? []
  const isLoading = typesQuery.isLoading

  const invalidates = [XRAY_TYPES_KEY]
  const createMutation = useApiMutation(createXrayType, { invalidates })
  const updateMutation = useApiMutation(
    (vars: { id: string; data: Parameters<typeof updateXrayType>[1] }) =>
      updateXrayType(vars.id, vars.data),
    { invalidates }
  )
  const deleteMutation = useApiMutation((id: string) => deleteXrayType(id), { invalidates })

  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<XrayType | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [toDelete, setToDelete] = useState<XrayType | null>(null)
  const [formData, setFormData] = useState({ name: '', displayName: '', description: '' })

  function openAdd() {
    setEditing(null)
    setFormData({ name: '', displayName: '', description: '' })
    setShowDialog(true)
  }

  function openEdit(t: XrayType) {
    setEditing(t)
    setFormData({ name: t.name, displayName: t.displayName, description: t.description || '' })
    setShowDialog(true)
  }

  async function handleSave() {
    if (!formData.displayName.trim()) {
      toast.error('Display name is required')
      return
    }
    const displayName = formData.displayName.trim()
    const description = formData.description.trim() || undefined
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, data: { displayName, description } })
        toast.success('X-ray type updated')
      } else {
        await createMutation.mutateAsync({
          name: toLookupSlug(displayName),
          displayName,
          description,
        })
        toast.success('X-ray type created')
      }
      setShowDialog(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  async function handleDelete() {
    if (!toDelete) return
    try {
      await deleteMutation.mutateAsync(toDelete.id)
      toast.success('X-ray type deleted')
      setDeleteOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>X-ray Types</CardTitle>
            <CardDescription>Manage x-ray types used when recording imaging.</CardDescription>
          </div>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Type
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Loading x-ray types…</div>
        ) : types.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">No x-ray types found.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Display Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.displayName}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {t.name}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.description || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.active ? 'default' : 'secondary'}>
                      {t.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setToDelete(t)
                          setDeleteOpen(true)
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
            <DialogTitle>{editing ? 'Edit X-ray Type' : 'Add X-ray Type'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update x-ray type details.' : 'Add a new x-ray type.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="xrt-display">Display Name *</Label>
              <Input
                id="xrt-display"
                placeholder="e.g., Periapical, Panoramic"
                value={formData.displayName}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    displayName: e.target.value,
                    name: editing ? prev.name : toLookupSlug(e.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                {editing ? 'Slug (fixed): ' : 'Slug: '}
                <span className="font-mono">
                  {editing ? editing.name : toLookupSlug(formData.displayName) || '…'}
                </span>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="xrt-desc">Description (optional)</Label>
              <Textarea
                id="xrt-desc"
                rows={2}
                placeholder="Brief description of this x-ray type"
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title="Delete X-ray Type"
        description="Are you sure you want to delete this x-ray type? This action cannot be undone."
        itemName={toDelete?.displayName}
      />
    </Card>
  )
}
