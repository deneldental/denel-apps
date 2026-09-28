import { ArrowLeft, Home, Pencil, Plus, Trash2, Truck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { getLabBaseServices, type LabBaseService } from '@/lib/actions/lab-base-services'
import { api } from '@/lib/api-client'
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
import { centsToInput, formatAmount, inputToCents } from '@/shared/utils/currency'
import type { LabVendor, LabVendorService, LabVendorServiceExpressOption } from '../types'
import { UNIT_TYPE_LABELS } from '../types'

const BASE_SERVICES_KEY = ['lab-base-services'] as const

export default function LabVendorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [addServiceOpen, setAddServiceOpen] = useState(false)
  const [editingService, setEditingService] = useState<LabVendorService | null>(null)
  const [deletingService, setDeletingService] = useState<LabVendorService | null>(null)

  const [expressDialogService, setExpressDialogService] = useState<LabVendorService | null>(null)

  // The /vendors GET we have returns the full list, not by id. Fall back.
  const vendorQuery = useApiQuery<LabVendor | null>(
    queryKeys.labs.vendorDetail(id ?? ''),
    async () => {
      const res = await api.get<LabVendor>(`/api/labs/vendors/${id}`)
      if (res.success && res.data) return { success: true as const, data: res.data }
      const all = await api.get<LabVendor[]>('/api/labs/vendors')
      if (all.success && all.data) {
        return { success: true as const, data: all.data.find((v) => v.id === id) ?? null }
      }
      return { success: false as const, error: res.error }
    },
    { enabled: !!id }
  )
  const vendor = vendorQuery.data ?? null

  const VENDOR_SERVICES_KEY = queryKeys.labs.vendorServices(id ?? '')
  const servicesQuery = useApiQuery<LabVendorService[]>(
    VENDOR_SERVICES_KEY,
    () => api.get<LabVendorService[]>(`/api/labs/vendors/${id}/services`),
    { enabled: !!id }
  )
  const services = servicesQuery.data ?? []

  // Shares its cache entry with labs/components/lab-base-services-tab.tsx.
  const baseServicesQuery = useApiQuery<LabBaseService[]>(BASE_SERVICES_KEY, () =>
    getLabBaseServices()
  )
  const baseServices = baseServicesQuery.data ?? []

  const loading = vendorQuery.isLoading || servicesQuery.isLoading || baseServicesQuery.isLoading

  const deleteServiceMutation = useApiMutation(
    (serviceId: string) => api.delete(`/api/labs/services/${serviceId}`),
    { invalidates: [VENDOR_SERVICES_KEY] }
  )

  async function handleDeleteService() {
    if (!deletingService) return
    await deleteServiceMutation.mutateAsync(deletingService.id)
    toast.success(`Removed ${deletingService.baseService?.name ?? 'service'}`)
    setDeletingService(null)
  }

  if (loading && !vendor) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!vendor) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate('/labs')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to vendors
        </Button>
        <p className="mt-6 text-sm text-muted-foreground">Vendor not found.</p>
      </div>
    )
  }

  // Base services not yet offered by this vendor → eligible for "add".
  const offeredIds = new Set(services.map((s) => s.baseServiceId))
  const availableBaseServices = baseServices.filter((b) => b.isActive && !offeredIds.has(b.id))

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <Link
          to="/labs"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to vendors
        </Link>
      </div>

      <Card>
        <CardContent className="py-5">
          <div className="flex items-start gap-4">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${
                vendor.type === 'internal'
                  ? 'bg-emerald-100 text-emerald-600'
                  : 'bg-blue-100 text-blue-600'
              }`}
            >
              {vendor.type === 'internal' ? (
                <Home className="h-5 w-5" />
              ) : (
                <Truck className="h-5 w-5" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{vendor.name}</h1>
                <Badge
                  variant={vendor.type === 'internal' ? 'default' : 'secondary'}
                  className="capitalize"
                >
                  {vendor.type}
                </Badge>
                {!vendor.active && <Badge variant="outline">Inactive</Badge>}
              </div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 text-sm text-muted-foreground">
                {vendor.contactEmail && <span>{vendor.contactEmail}</span>}
                {vendor.contactPhone && <span>{vendor.contactPhone}</span>}
                {vendor.address && <span className="md:col-span-3">{vendor.address}</span>}
                {vendor.notes && <span className="md:col-span-3 italic">{vendor.notes}</span>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-base">Services offered</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pick a base service and supply this vendor's price + turnaround. Add express options
              per service.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditingService(null)
              setAddServiceOpen(true)
            }}
            disabled={availableBaseServices.length === 0}
            title={
              availableBaseServices.length === 0
                ? 'Create more base services in the Services module first'
                : undefined
            }
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add service
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : services.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              This vendor doesn't offer any services yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Cost to clinic</TableHead>
                  <TableHead>Price to patient</TableHead>
                  <TableHead>Turnaround</TableHead>
                  <TableHead>Express options</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.baseService?.name ?? 'Unknown'}</div>
                      {s.baseService?.category?.name && (
                        <div className="text-xs text-muted-foreground">
                          {s.baseService.category.name}
                        </div>
                      )}
                      {!s.active && (
                        <Badge variant="outline" className="text-[10px] mt-1">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.baseService ? UNIT_TYPE_LABELS[s.baseService.unitType] : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.regularCost != null ? `GHS ${formatAmount(Number(s.regularCost))}` : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.clinicPrice != null ? `GHS ${formatAmount(Number(s.clinicPrice))}` : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.regularTurnaroundDays != null ? `${s.regularTurnaroundDays} days` : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(s.expressOptions ?? []).filter((eo) => eo.isActive).length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          s.expressOptions
                            ?.filter((eo) => eo.isActive)
                            .map((eo) => (
                              <Badge key={eo.id} variant="outline" className="text-[10px]">
                                {eo.label}: GHS {Number(eo.cost).toFixed(0)} · {eo.turnaroundDays}d
                              </Badge>
                            ))
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => setExpressDialogService(s)}
                        >
                          Manage
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditingService(s)
                            setAddServiceOpen(true)
                          }}
                          aria-label="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeletingService(s)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {addServiceOpen && vendor && (
        <VendorServiceDialog
          vendorId={vendor.id}
          existing={editingService}
          baseServices={editingService ? baseServices : availableBaseServices}
          onClose={() => {
            setAddServiceOpen(false)
            setEditingService(null)
          }}
        />
      )}

      {expressDialogService && (
        <ExpressOptionsDialog
          vendorService={expressDialogService}
          onClose={() => setExpressDialogService(null)}
        />
      )}

      <DeleteConfirmationDialog
        open={!!deletingService}
        onOpenChange={(o) => !o && setDeletingService(null)}
        onConfirm={handleDeleteService}
        title="Remove service offering?"
        description="This vendor will stop offering the selected service. Existing lab cases keep their snapshot."
        itemName={deletingService?.baseService?.name}
      />
    </div>
  )
}

// ── Vendor service create/edit dialog ────────────────────────────────────────

function VendorServiceDialog({
  vendorId,
  existing,
  baseServices,
  onClose,
}: {
  vendorId: string
  existing: LabVendorService | null
  baseServices: LabBaseService[]
  onClose: () => void
}) {
  const [baseServiceId, setBaseServiceId] = useState<string>(existing?.baseServiceId ?? '')
  const [regularCost, setRegularCost] = useState(centsToInput(existing?.regularCost))
  const [clinicPrice, setClinicPrice] = useState(centsToInput(existing?.clinicPrice))
  const [regularTurnaroundDays, setRegularTurnaroundDays] = useState(
    existing?.regularTurnaroundDays?.toString() ?? ''
  )
  const [active, setActive] = useState(existing?.active ?? true)

  const saveMutation = useApiMutation(
    (payload: {
      baseServiceId: string
      regularCost: number
      clinicPrice: number | null
      regularTurnaroundDays: number
      active: boolean
    }) =>
      existing
        ? api.patch(`/api/labs/services/${existing.id}`, payload)
        : api.post(`/api/labs/vendors/${vendorId}/services`, payload),
    { invalidates: [queryKeys.labs.vendorServices(vendorId)] }
  )
  const saving = saveMutation.isPending

  // When picking a base, pre-fill turnaround from its standard if empty.
  useEffect(() => {
    if (!baseServiceId || existing) return
    const b = baseServices.find((x) => x.id === baseServiceId)
    if (b && !regularTurnaroundDays && b.standardTurnaroundDays) {
      setRegularTurnaroundDays(String(b.standardTurnaroundDays))
    }
  }, [baseServiceId, baseServices, existing, regularTurnaroundDays])

  async function handleSave() {
    if (!baseServiceId) {
      toast.error('Pick a base service')
      return
    }
    const cost = inputToCents(regularCost)
    if (cost < 0) {
      toast.error('Cost must be a non-negative number')
      return
    }
    const price = clinicPrice && clinicPrice.trim() !== '' ? inputToCents(clinicPrice) : null
    if (price !== null && price < 0) {
      toast.error('Price to patient must be a non-negative number')
      return
    }
    const days = parseInt(regularTurnaroundDays, 10)
    if (Number.isNaN(days) || days < 0) {
      toast.error('Turnaround must be a non-negative integer')
      return
    }
    try {
      await saveMutation.mutateAsync({
        baseServiceId,
        regularCost: cost,
        clinicPrice: price,
        regularTurnaroundDays: days,
        active,
      })
      toast.success(existing ? 'Service updated' : 'Service added')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit service offering' : 'Add service offering'}</DialogTitle>
          <DialogDescription>
            Set this vendor's price and turnaround for the chosen base service. Manage express tiers
            separately after saving.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Base service</Label>
            <Select
              value={baseServiceId}
              onValueChange={setBaseServiceId}
              disabled={saving || !!existing}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a base service" />
              </SelectTrigger>
              <SelectContent>
                {baseServices.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No base services available.
                  </div>
                ) : (
                  baseServices.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                      {b.category?.name ? ` · ${b.category.name}` : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Cost to clinic (GHS)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={regularCost}
                onChange={(e) => setRegularCost(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>Price to patient (GHS)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={clinicPrice}
                onChange={(e) => setClinicPrice(e.target.value)}
                disabled={saving}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label>Turnaround (days)</Label>
              <Input
                type="number"
                min={0}
                value={regularTurnaroundDays}
                onChange={(e) => setRegularTurnaroundDays(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="text-sm font-medium">Active</Label>
              <p className="text-xs text-muted-foreground">
                Inactive offerings hide from the case form.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} disabled={saving} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !baseServiceId}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Add service'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Express options dialog (multiple per vendor-service) ─────────────────────

function ExpressOptionsDialog({
  vendorService,
  onClose,
}: {
  vendorService: LabVendorService
  onClose: () => void
}) {
  const [options, setOptions] = useState<LabVendorServiceExpressOption[]>(
    vendorService.expressOptions ?? []
  )
  const [label, setLabel] = useState('')
  const [cost, setCost] = useState('')
  const [turnaroundDays, setTurnaroundDays] = useState('')

  const invalidates = [queryKeys.labs.vendorServices(vendorService.vendorId)]
  const addOptionMutation = useApiMutation(
    (vars: { label: string; cost: number; turnaroundDays: number }) =>
      api.post<LabVendorServiceExpressOption>(
        `/api/labs/services/${vendorService.id}/express-options`,
        vars
      ),
    { invalidates }
  )
  const removeOptionMutation = useApiMutation(
    (optionId: string) => api.delete(`/api/labs/express-options/${optionId}`),
    { invalidates }
  )
  const saving = addOptionMutation.isPending

  async function addOption() {
    const c = inputToCents(cost)
    const d = parseInt(turnaroundDays, 10)
    if (!label.trim()) {
      toast.error('Label required')
      return
    }
    if (c < 0) {
      toast.error('Cost must be a non-negative number')
      return
    }
    if (Number.isNaN(d) || d < 0) {
      toast.error('Turnaround must be a non-negative integer')
      return
    }
    try {
      const data = await addOptionMutation.mutateAsync({
        label: label.trim(),
        cost: c,
        turnaroundDays: d,
      })
      setOptions((prev) => [...prev, data])
      setLabel('')
      setCost('')
      setTurnaroundDays('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add')
    }
  }

  async function removeOption(id: string) {
    try {
      await removeOptionMutation.mutateAsync(id)
      setOptions((prev) => prev.filter((o) => o.id !== id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Express options — {vendorService.baseService?.name}</DialogTitle>
          <DialogDescription>
            Add as many express tiers as the lab offers. Each is selectable on the case form.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {options.length > 0 && (
            <ul className="divide-y divide-border rounded-md border">
              {options.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{o.label}</p>
                    <p className="text-xs text-muted-foreground">
                      GHS {formatAmount(Number(o.cost))} · {o.turnaroundDays} days
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeOption(o.id)}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-md border border-dashed p-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Add new option</p>
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="Label (24hr)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={saving}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Cost"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                disabled={saving}
              />
              <Input
                type="number"
                min={0}
                placeholder="Days"
                value={turnaroundDays}
                onChange={(e) => setTurnaroundDays(e.target.value)}
                disabled={saving}
              />
            </div>
            <Button
              size="sm"
              onClick={addOption}
              disabled={saving || !label.trim() || !cost.trim() || !turnaroundDays.trim()}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add option
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
