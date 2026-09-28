import { toLookupSlug } from '@denel/utils'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createDocumentTag,
  type DocumentTag,
  deleteDocumentTag,
  getDocumentTags,
  updateDocumentTag,
} from '@/lib/actions/document-tags'
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

type TagColor = 'slate' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'pink' | 'cyan'

const TAG_COLORS: Array<{ value: TagColor; label: string; className: string }> = [
  { value: 'slate', label: 'Slate', className: 'bg-slate-100 text-foreground' },
  { value: 'blue', label: 'Blue', className: 'bg-blue-100 text-blue-700' },
  { value: 'green', label: 'Green', className: 'bg-green-100 text-green-700' },
  { value: 'yellow', label: 'Yellow', className: 'bg-yellow-100 text-yellow-700' },
  { value: 'red', label: 'Red', className: 'bg-red-100 text-red-700' },
  { value: 'purple', label: 'Purple', className: 'bg-purple-100 text-purple-700' },
  { value: 'pink', label: 'Pink', className: 'bg-pink-100 text-pink-700' },
  { value: 'cyan', label: 'Cyan', className: 'bg-cyan-100 text-cyan-700' },
]

// Document tags keep the kebab-case their schema documents ("consent-form").
const toSlug = (s: string) => toLookupSlug(s, { separator: '-' })

const colorClass = (color: string) =>
  TAG_COLORS.find((c) => c.value === color)?.className ?? TAG_COLORS[0].className

const DOCUMENT_TAGS_KEY = queryKeys.settings.lookup('document-tags')

export function DocumentTagsSection() {
  const { data: tags = [], isLoading: loading } = useApiQuery(DOCUMENT_TAGS_KEY, getDocumentTags)
  const invalidates = [DOCUMENT_TAGS_KEY]
  const createMutation = useApiMutation(createDocumentTag, { invalidates })
  const updateMutation = useApiMutation(
    (vars: { id: string; data: Parameters<typeof updateDocumentTag>[1] }) =>
      updateDocumentTag(vars.id, vars.data),
    { invalidates }
  )
  const deleteMutation = useApiMutation((id: string) => deleteDocumentTag(id), { invalidates })

  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<DocumentTag | null>(null)
  const [form, setForm] = useState<{ displayName: string; color: TagColor }>({
    displayName: '',
    color: 'slate',
  })
  const [deleteTarget, setDeleteTarget] = useState<DocumentTag | null>(null)

  function openAdd() {
    setEditing(null)
    setForm({ displayName: '', color: 'slate' })
    setShowDialog(true)
  }

  function openEdit(t: DocumentTag) {
    setEditing(t)
    setForm({ displayName: t.displayName, color: t.color as TagColor })
    setShowDialog(true)
  }

  async function handleSave() {
    const displayName = form.displayName.trim()
    if (!displayName) {
      toast.error('Tag name is required')
      return
    }
    const name = toSlug(displayName)
    if (!name) {
      toast.error('Tag name must contain letters or numbers')
      return
    }

    try {
      if (editing) {
        await updateMutation.mutateAsync({
          id: editing.id,
          data: { displayName, color: form.color },
        })
        toast.success('Tag updated')
      } else {
        await createMutation.mutateAsync({ name, displayName, color: form.color })
        toast.success('Tag created')
      }
      setShowDialog(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to ${editing ? 'update' : 'create'} tag`
      )
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success('Tag deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete tag')
    }
    setDeleteTarget(null)
  }

  async function toggleActive(t: DocumentTag) {
    try {
      await updateMutation.mutateAsync({ id: t.id, data: { isActive: !t.isActive } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update tag')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <CardTitle>Document Tags</CardTitle>
            <CardDescription>
              Tags used to categorize documents uploaded to a patient record (e.g. X-ray, Insurance,
              Lab Result).
            </CardDescription>
          </div>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Tag
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : tags.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No document tags yet. Add one to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tags.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${colorClass(t.color)}`}
                    >
                      {t.displayName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{t.name}</code>
                  </TableCell>
                  <TableCell>
                    <button type="button" onClick={() => toggleActive(t)}>
                      <Badge variant={t.isActive ? 'default' : 'secondary'}>
                        {t.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(t)}
                        title="Delete tag"
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
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Tag' : 'Add Tag'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="dt-display">Tag Name</Label>
              <Input
                id="dt-display"
                placeholder="e.g. X-ray, Insurance, Lab Result"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Key: <code className="font-mono">{toSlug(form.displayName) || '…'}</code>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c.value }))}
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all ${c.className} ${
                      form.color === c.value
                        ? 'ring-2 ring-offset-1 ring-foreground/40'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Document Tag"
        description="This will remove the tag from the picker. Documents already tagged will keep the tag label."
        itemName={deleteTarget?.displayName}
      />
    </Card>
  )
}
