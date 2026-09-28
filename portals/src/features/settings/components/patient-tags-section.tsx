import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { TAG_COLOR_CLASSES, tagClass } from '@/features/patients/components/tag-pills'
import {
  createPatientTag,
  deletePatientTag,
  type PatientTag,
  updatePatientTag,
} from '@/lib/actions/patient-tags'
import { useApiMutation } from '@/lib/query'
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
import { usePatientTagCatalog } from '@/shared/hooks/use-patient-tag-catalog'

// Palette comes from tag-pills so a colour picked here renders identically in
// the patient table, detail header and form pickers.
const COLORS = Object.keys(TAG_COLOR_CLASSES)

/** What each system tag does, so an admin knows why it cannot be removed. */
const SYSTEM_KEY_PURPOSE: Record<string, string> = {
  insurance: 'Opens the insurance provider and policy fields when adding or editing a patient.',
  xray: 'Reserved for X-ray workflows.',
  lab: 'Reserved for lab workflows.',
}

export function PatientTagsSection() {
  const { catalog: tags, isLoading: loading } = usePatientTagCatalog()
  const invalidates = [queryKeys.patientTags.all]
  const createMutation = useApiMutation(
    (vars: { name: string; color: string }) => createPatientTag(vars.name, vars.color),
    { invalidates }
  )
  const updateMutation = useApiMutation(
    (vars: { id: string; data: Parameters<typeof updatePatientTag>[1] }) =>
      updatePatientTag(vars.id, vars.data),
    { invalidates }
  )
  const deleteMutation = useApiMutation((id: string) => deletePatientTag(id), { invalidates })

  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<PatientTag | null>(null)
  const [form, setForm] = useState<{ name: string; color: string }>({ name: '', color: 'slate' })
  const [deleteTarget, setDeleteTarget] = useState<PatientTag | null>(null)

  function openAdd() {
    setEditing(null)
    setForm({ name: '', color: 'slate' })
    setShowDialog(true)
  }

  function openEdit(t: PatientTag) {
    setEditing(t)
    setForm({ name: t.name, color: t.color })
    setShowDialog(true)
  }

  async function handleSave() {
    const name = form.name.trim()
    if (!name) {
      toast.error('Tag name is required')
      return
    }

    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, data: { name, color: form.color } })
        toast.success('Tag updated')
      } else {
        await createMutation.mutateAsync({ name, color: form.color })
        toast.success('Tag created')
      }
      setShowDialog(false)
    } catch (err) {
      // The server answers 409 with the conflicting name for case-insensitive
      // clashes, which is the message worth surfacing verbatim.
      toast.error(
        err instanceof Error ? err.message : `Failed to ${editing ? 'update' : 'create'} tag`
      )
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      const result = await deleteMutation.mutateAsync(deleteTarget.id)
      const n = result?.patientsUntagged ?? 0
      toast.success(
        n > 0 ? `Tag deleted and removed from ${n} patient${n === 1 ? '' : 's'}` : 'Tag deleted'
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete tag')
    }
    setDeleteTarget(null)
  }

  async function toggleActive(t: PatientTag) {
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
            <CardTitle>Patient Tags</CardTitle>
            <CardDescription>
              Labels applied to patients and used to filter the patient list. Tags marked{' '}
              <span className="font-medium">System</span> drive behaviour elsewhere in the app —
              they can be renamed and recoloured, but not removed.
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
            No patient tags yet. Add one to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tags.map((t) => {
                const isSystem = !!t.isSystem || !!t.systemKey
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tagClass(t.color)}`}
                        >
                          {t.name}
                        </span>
                        {isSystem && (
                          <Badge variant="outline" className="gap-1">
                            <Lock className="h-3 w-3" />
                            System
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-sm text-xs text-muted-foreground">
                      {t.systemKey ? (SYSTEM_KEY_PURPOSE[t.systemKey] ?? 'Reserved tag.') : '—'}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => toggleActive(t)}
                        disabled={isSystem}
                        title={
                          isSystem
                            ? 'System tags stay active — deactivating would silently disable the behaviour they drive'
                            : t.isActive
                              ? 'Deactivate'
                              : 'Activate'
                        }
                        className={isSystem ? 'cursor-not-allowed opacity-60' : undefined}
                      >
                        <Badge variant={t.isActive === false ? 'secondary' : 'default'}>
                          {t.isActive === false ? 'Inactive' : 'Active'}
                        </Badge>
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(t)}
                          title="Rename or recolour"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(t)}
                          disabled={isSystem}
                          title={isSystem ? 'System tags cannot be deleted' : 'Delete tag'}
                        >
                          <Trash2
                            className={`h-4 w-4 ${isSystem ? 'text-muted-foreground' : 'text-destructive'}`}
                          />
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
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Tag' : 'Add Tag'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editing?.systemKey && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {SYSTEM_KEY_PURPOSE[editing.systemKey] ?? 'Reserved tag.'} Renaming is safe — the
                behaviour is keyed to <code className="font-mono">{editing.systemKey}</code>, not
                the name.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pt-name">Tag Name</Label>
              <Input
                id="pt-name"
                placeholder="e.g. Ortho, VIP, Recall Due"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize transition-all ${tagClass(c)} ${
                      form.color === c
                        ? 'ring-2 ring-foreground/40 ring-offset-1'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    {c}
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
        title="Delete Patient Tag"
        description="This removes the tag from the catalog and untags every patient currently carrying it. This cannot be undone."
        itemName={deleteTarget?.name}
      />
    </Card>
  )
}
