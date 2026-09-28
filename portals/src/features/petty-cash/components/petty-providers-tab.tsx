import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createServiceProvider,
  deleteServiceProvider,
  getServiceProviders,
  type ServiceProvider,
  updateServiceProvider,
} from '@/lib/actions/petty-cash'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
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

// No shared query-key group exists for petty-cash providers — local literal,
// module-scoped. Intentionally the same literal value as `petty-ref-picker.tsx`
// uses for its "service_provider" branch, so the two caches invalidate together.
const PETTY_PROVIDERS_KEY = ['petty-cash', 'providers'] as const

/** Reusable service-provider directory (name + phone) for maintenance/repairs. */
export function PettyProvidersTab() {
  const { data: providers = [], isLoading: loading } = useApiQuery(PETTY_PROVIDERS_KEY, () =>
    getServiceProviders()
  )
  const [editing, setEditing] = useState<ServiceProvider | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const saveProvider = useApiMutation(
    (vars: { id: string | null; name: string; contact: string }) =>
      vars.id
        ? updateServiceProvider(vars.id, { name: vars.name, contact: vars.contact })
        : createServiceProvider({ name: vars.name, contact: vars.contact }),
    { invalidates: [PETTY_PROVIDERS_KEY] }
  )
  const removeProvider = useApiMutation((id: string) => deleteServiceProvider(id), {
    invalidates: [PETTY_PROVIDERS_KEY],
  })
  const saving = saveProvider.isPending

  function openNew() {
    setEditing(null)
    setName('')
    setContact('')
    setFormOpen(true)
  }
  function openEdit(p: ServiceProvider) {
    setEditing(p)
    setName(p.name)
    setContact(p.contact ?? '')
    setFormOpen(true)
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    try {
      await saveProvider.mutateAsync({
        id: editing?.id ?? null,
        name: name.trim(),
        contact: contact.trim(),
      })
      toast.success(editing ? 'Provider updated' : 'Provider added')
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      await removeProvider.mutateAsync(deleteId)
      setDeleteId(null)
      toast.success('Provider removed')
    } catch (err) {
      setDeleteId(null)
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">Service providers</h2>
          <p className="text-sm text-muted-foreground">
            People/vendors paid for maintenance & repairs — reused in the errand/maintenance picker.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" /> Add provider
        </Button>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : providers.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          No service providers yet.
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {providers.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.contact || 'No contact'}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(p)} aria-label="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => setDeleteId(p.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit provider' : 'Add provider'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Kwame — plumber"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contact (phone)</Label>
              <Input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="0244…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={handleDelete}
        title="Remove provider?"
        description="They'll no longer appear in the picker. Existing expenses keep their recorded name + contact."
      />
    </div>
  )
}
