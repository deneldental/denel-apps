import { toLookupSlug } from '@denel/utils'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
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
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

type LookupItem = {
  id: string
  name: string
  displayName: string | null
  isActive: boolean
}

interface ClinicalLookupSectionProps {
  /** Slug used in /api/lookups/:type. */
  type: string
  title: string
  description: string
  /** Singular noun for button/dialog copy ("Complaint", "Allergy"). */
  noun: string
}

/**
 * Generic CRUD section backed by the /api/lookups/:type endpoint. Used for the
 * clinical-stage option lookups (presenting complaints, allergies, ortho
 * treatments, drug frequencies, etc.).
 */
export function ClinicalLookupSection({
  type,
  title,
  description,
  noun,
}: ClinicalLookupSectionProps) {
  const [items, setItems] = useState<LookupItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<LookupItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LookupItem | null>(null)
  const [formData, setFormData] = useState({ displayName: '' })
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const { isSubmitting, submit } = useSubmitGuard()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<LookupItem[]>(`/api/lookups/${type}/all`)
    if (res.success && res.data) setItems(res.data as LookupItem[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  async function handleSave() {
    const trimmedDisplay = formData.displayName.trim()
    if (!trimmedDisplay) {
      toast.error('Display name is required')
      return
    }
    const slug = toLookupSlug(trimmedDisplay)
    if (!slug) {
      toast.error('Display name must contain at least one letter or digit')
      return
    }
    if (trimmedDisplay.length > 200) {
      toast.error('Display name must be 200 characters or fewer')
      return
    }
    await submit(async () => {
      if (editing) {
        // The slug is fixed once created — it is what case-stage snapshots
        // reference — so an edit only carries the label.
        const res = await api.patch(`/api/lookups/${type}/${editing.id}`, {
          displayName: trimmedDisplay,
        })
        if (res.success) {
          toast.success(`${noun} updated`)
          await load()
          setShowDialog(false)
        } else {
          surfaceApiError(res, 'Failed to update')
        }
      } else {
        const res = await api.post(`/api/lookups/${type}`, {
          name: slug,
          displayName: trimmedDisplay,
        })
        if (res.success) {
          toast.success(`${noun} created`)
          await load()
          setShowDialog(false)
        } else {
          surfaceApiError(res, 'Failed to create')
        }
      }
    })
  }

  async function deactivate(target: LookupItem) {
    setMutatingId(target.id)
    try {
      const res = await api.patch(`/api/lookups/${type}/${target.id}`, { isActive: false })
      if (res.success) {
        toast.success(`${noun} deactivated`)
        await load()
      } else {
        surfaceApiError(res, 'Failed to deactivate')
      }
    } finally {
      setMutatingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    const res = await api.delete<{ count?: number; refLabel?: string }>(
      `/api/lookups/${type}/${target.id}`
    )
    if (res.success) {
      toast.success(`${noun} deleted`)
      await load()
    } else if (res.code === 'LOOKUP_IN_USE') {
      // Row is still referenced — offer deactivation as a fallback.
      toast.error(res.error ?? `${noun} is in use`, {
        action: {
          label: 'Deactivate',
          onClick: () => deactivate(target),
        },
        duration: 8000,
      })
    } else {
      surfaceApiError(res, 'Failed to delete')
    }
    setDeleteTarget(null)
  }

  async function reactivate(target: LookupItem) {
    setMutatingId(target.id)
    try {
      const res = await api.patch(`/api/lookups/${type}/${target.id}`, { isActive: true })
      if (res.success) {
        toast.success(`${noun} reactivated`)
        await load()
      } else {
        surfaceApiError(res, 'Failed to reactivate')
      }
    } finally {
      setMutatingId(null)
    }
  }

  function openAdd() {
    setEditing(null)
    setFormData({ displayName: '' })
    setShowDialog(true)
  }

  function openEdit(item: LookupItem) {
    setEditing(item)
    setFormData({ displayName: item.displayName ?? item.name })
    setShowDialog(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add {noun}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No {title.toLowerCase()} configured.
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
                      {!item.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reactivate(item)}
                          title="Reactivate"
                          disabled={mutatingId === item.id}
                        >
                          {mutatingId === item.id ? 'Saving…' : 'Reactivate'}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(item)}
                        title="Delete"
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
            <DialogTitle>{editing ? `Edit ${noun}` : `Add ${noun}`}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update the display name.' : `Create a new ${noun.toLowerCase()}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="lookup-display">Display name *</Label>
              <Input
                id="lookup-display"
                value={formData.displayName}
                onChange={(e) => setFormData({ displayName: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isSubmitting) handleSave()
                }}
                autoFocus
                placeholder="e.g. Tooth Pain"
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">
                {editing ? 'Internal name (fixed): ' : 'Internal name: '}
                <span className="font-mono">
                  {editing ? editing.name : toLookupSlug(formData.displayName) || '…'}
                </span>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={handleDelete}
        title={`Delete ${noun}`}
        description="The item is removed permanently. If it's still referenced anywhere, deletion is blocked — you'll be offered to deactivate it instead."
        itemName={deleteTarget?.displayName ?? deleteTarget?.name}
      />
    </Card>
  )
}
