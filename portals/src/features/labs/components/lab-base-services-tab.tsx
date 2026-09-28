import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createLabBaseService,
  deleteLabBaseService,
  getLabBaseServices,
  type LabBaseService,
  updateLabBaseService,
} from '@/lib/actions/lab-base-services'
import { type ApplicationScope, getApplicationScopes } from '@/lib/actions/services'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
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
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'

/**
 * Lab base services catalog (0171). Base services are the vendor-agnostic
 * templates (Crown, Bridge, Denture…); vendors extend one via lab_services with
 * their own cost and turnaround. They carry an application type
 * (unit/tooth/arch/bridge…) instead of the old per_case/per_tooth/per_arch
 * unitType, and the "categories" layer is retired.
 *
 * Lives in the Labs module: this is the lab-side catalogue. A clinic-facing
 * price-list entry is a `services` row of category `lab` that references one of
 * these through `services.labBaseServiceId`.
 */
const BASE_SERVICES_KEY = ['lab-base-services'] as const

export function LabBaseServicesTab({ isAdmin }: { isAdmin: boolean }) {
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false)
  const [editingService, setEditingService] = useState<LabBaseService | null>(null)
  const [deletingService, setDeletingService] = useState<LabBaseService | null>(null)

  const baseServicesQuery = useApiQuery<LabBaseService[]>(BASE_SERVICES_KEY, () =>
    getLabBaseServices()
  )
  const baseServices = baseServicesQuery.data ?? []

  const scopesQuery = useApiQuery<ApplicationScope[]>(queryKeys.services.scopes(), () =>
    getApplicationScopes()
  )
  const scopes = scopesQuery.data ?? []

  const loading = baseServicesQuery.isLoading || scopesQuery.isLoading

  const deleteMutation = useApiMutation((id: string) => deleteLabBaseService(id), {
    invalidates: [BASE_SERVICES_KEY],
  })

  async function handleDeleteService() {
    if (!deletingService) return
    await deleteMutation.mutateAsync(deletingService.id)
    toast.success(`Service "${deletingService.name}" deleted`)
    setDeletingService(null)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-base">Lab services</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Templates each lab (vendor) prices with their own cost + turnaround. The application
              type drives how the case form lays out units.
            </p>
          </div>
          {/* Creating a lab service is admin-only (enforced server-side too);
              everyone else edits an existing one, which files a change request. */}
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => {
                setEditingService(null)
                setServiceDialogOpen(true)
              }}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New lab service
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : baseServices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {isAdmin
                ? "No lab services yet. Create one, then set each lab's price on the vendor page."
                : 'No lab services yet. An administrator adds these.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Application type</TableHead>
                  <TableHead>Std turnaround</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {baseServices.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        {!s.isActive && <Badge variant="outline">Inactive</Badge>}
                      </div>
                      {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.scope?.displayName ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.standardTurnaroundDays ? `${s.standardTurnaroundDays} days` : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditingService(s)
                            setServiceDialogOpen(true)
                          }}
                          aria-label="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeletingService(s)}
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
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
      </Card>

      {serviceDialogOpen && (
        <BaseServiceFormDialog
          existing={editingService}
          isAdmin={isAdmin}
          scopes={scopes}
          onClose={() => {
            setServiceDialogOpen(false)
            setEditingService(null)
          }}
        />
      )}

      <DeleteConfirmationDialog
        open={!!deletingService}
        onOpenChange={(o) => !o && setDeletingService(null)}
        onConfirm={handleDeleteService}
        title="Delete lab service?"
        description="All vendor pricing entries for this service will be removed. Existing lab cases keep their snapshot."
        itemName={deletingService?.name}
      />
    </div>
  )
}

function BaseServiceFormDialog({
  existing,
  isAdmin,
  scopes,
  onClose,
}: {
  existing: LabBaseService | null
  isAdmin: boolean
  scopes: ApplicationScope[]
  onClose: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [scopeId, setScopeId] = useState<string>(existing?.scopeId ?? '')
  const [standardTurnaroundDays, setStandardTurnaroundDays] = useState(
    existing?.standardTurnaroundDays?.toString() ?? '7'
  )
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [isActive, setIsActive] = useState(existing?.isActive ?? true)

  const saveMutation = useApiMutation(
    (payload: {
      name: string
      scopeId: string | null
      standardTurnaroundDays: number
      notes: string | null
      isActive: boolean
    }) => (existing ? updateLabBaseService(existing.id, payload) : createLabBaseService(payload)),
    { invalidates: [BASE_SERVICES_KEY] }
  )
  const saving = saveMutation.isPending

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    const days = parseInt(standardTurnaroundDays, 10)
    if (Number.isNaN(days) || days < 0) {
      toast.error('Standard turnaround must be a non-negative integer')
      return
    }
    try {
      await saveMutation.mutateAsync({
        name: name.trim(),
        scopeId: scopeId || null,
        standardTurnaroundDays: days,
        notes: notes.trim() || null,
        isActive,
      })
      if (!isAdmin && existing) {
        toast.success(`Change to "${name}" submitted for admin approval.`)
      } else {
        toast.success(existing ? `Service "${name}" updated` : `Service "${name}" created`)
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit lab service' : 'New lab service'}</DialogTitle>
          <DialogDescription>
            Each lab (vendor) sets its own price + turnaround for this on the vendor page. The
            application type drives how the case form lays out units.
          </DialogDescription>
        </DialogHeader>
        {!isAdmin && existing && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Changes will be submitted for admin approval before going live.
          </p>
        )}
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Monolithic Zirconia Crown"
              disabled={saving}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Application type</Label>
              <Select
                value={scopeId || '__none'}
                onValueChange={(v) => setScopeId(v === '__none' ? '' : v)}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None (per unit)</SelectItem>
                  {scopes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Standard turnaround (days)</Label>
              <Input
                type="number"
                min={0}
                value={standardTurnaroundDays}
                onChange={(e) => setStandardTurnaroundDays(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes ?? ''}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional. Visible when picking the service."
              disabled={saving}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="text-sm font-medium">Active</Label>
              <p className="text-xs text-muted-foreground">Inactive services hide in catalog.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} disabled={saving} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
