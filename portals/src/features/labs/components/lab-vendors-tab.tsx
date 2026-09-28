import type { ColumnDef } from '@tanstack/react-table'
import { Home, Pencil, Plus, Trash2, Truck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useCan } from '@/lib/permissions-context'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'
import type { LabVendor, VendorType } from '../types'

interface Props {
  vendors: LabVendor[]
  onChanged: () => void
}

const COMMISSION_KEY = 'lab_commission_enabled'

export function LabVendorsTab({ vendors, onChanged }: Props) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<LabVendor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LabVendor | null>(null)
  const [commissionEnabled, setCommissionEnabled] = useState(false)
  const [commissionSaving, setCommissionSaving] = useState(false)
  const canDelete = useCan('labs', 'delete')
  // The commission switch is clinic settings, not labs — reading and writing the
  // KV both need `settings:*`, which a labs-capable role doesn't imply.
  const canConfigureCommission = useCan('settings', 'update')

  // Load the clinic-wide "lab work pays doctor commission" toggle.
  useEffect(() => {
    if (!canConfigureCommission) return
    api.get<boolean>(`/api/settings/kv/${COMMISSION_KEY}`).then((res) => {
      if (res.success) setCommissionEnabled(Boolean(res.data))
    })
  }, [canConfigureCommission])

  async function toggleCommission(next: boolean) {
    setCommissionSaving(true)
    setCommissionEnabled(next)
    const res = await api.put(`/api/settings/kv/${COMMISSION_KEY}`, { value: next })
    setCommissionSaving(false)
    if (!res.success) {
      setCommissionEnabled(!next)
      toast.error((res.error as string) || 'Failed to save')
    } else {
      toast.success(next ? 'Lab commission enabled' : 'Lab commission disabled')
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const res = await api.delete(`/api/labs/vendors/${deleteTarget.id}`)
    if (res.success) {
      toast.success('Deleted')
      setDeleteTarget(null)
      onChanged()
    } else {
      toast.error((res.error as string) || 'Failed')
      throw new Error('delete failed')
    }
  }

  const columns = useMemo<ColumnDef<LabVendor>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => {
          const v = row.original
          return (
            <button
              type="button"
              className="flex items-center gap-2 text-left hover:underline"
              onClick={() => navigate(`/labs/vendors/${v.id}`)}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded ${
                  v.type === 'internal'
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-blue-100 text-blue-600'
                }`}
              >
                {v.type === 'internal' ? (
                  <Home className="h-3.5 w-3.5" />
                ) : (
                  <Truck className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="font-medium">{v.name}</span>
            </button>
          )
        },
      },
      {
        accessorKey: 'type',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <Badge
            variant={row.original.type === 'internal' ? 'default' : 'secondary'}
            className="capitalize"
          >
            {row.original.type}
          </Badge>
        ),
        filterFn: (row, _id, value) =>
          Array.isArray(value) ? value.includes(row.original.type) : true,
      },
      {
        accessorKey: 'active',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge variant={row.original.active ? 'success' : 'outline'}>
            {row.original.active ? 'Active' : 'Inactive'}
          </Badge>
        ),
        filterFn: (row, _id, value) => {
          if (!Array.isArray(value)) return true
          return value.includes(row.original.active ? 'active' : 'inactive')
        },
      },
      {
        accessorKey: 'contactEmail',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
        cell: ({ row }) => row.original.contactEmail ?? '—',
      },
      {
        accessorKey: 'contactPhone',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Phone" />,
        cell: ({ row }) => row.original.contactPhone ?? '—',
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-1 justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(row.original)
                setOpen(true)
              }}
              aria-label="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteTarget(row.original)
                }}
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [navigate, canDelete]
  )

  return (
    <div className="space-y-4">
      {canConfigureCommission && (
        <Card>
          <CardContent className="py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Lab work pays doctor commission</p>
              <p className="text-xs text-muted-foreground">
                When on, the assigned doctor earns their commission rate on the lab margin (patient
                charge − lab cost) for every case.
              </p>
            </div>
            <Switch
              checked={commissionEnabled}
              onCheckedChange={toggleCommission}
              disabled={commissionSaving}
            />
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Lab Vendors</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Vendor
        </Button>
      </div>

      <DataTable columns={columns} data={vendors} />

      <VendorFormDialog
        open={open}
        onOpenChange={setOpen}
        vendor={editing}
        onSaved={() => {
          setOpen(false)
          onChanged()
        }}
      />

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete lab vendor?"
        description="The vendor and all its service pricing will be removed. Existing lab cases keep their snapshot."
        itemName={deleteTarget?.name}
      />
    </div>
  )
}

function VendorFormDialog({
  open,
  onOpenChange,
  vendor,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  vendor: LabVendor | null
  onSaved: () => void
}) {
  const [name, setName] = useState(vendor?.name ?? '')
  const [type, setType] = useState<VendorType>(vendor?.type ?? 'external')
  const [contactEmail, setContactEmail] = useState(vendor?.contactEmail ?? '')
  const [contactPhone, setContactPhone] = useState(vendor?.contactPhone ?? '')
  const [address, setAddress] = useState(vendor?.address ?? '')
  const [notes, setNotes] = useState(vendor?.notes ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(vendor?.name ?? '')
    setType(vendor?.type ?? 'external')
    setContactEmail(vendor?.contactEmail ?? '')
    setContactPhone(vendor?.contactPhone ?? '')
    setAddress(vendor?.address ?? '')
    setNotes(vendor?.notes ?? '')
  }, [open, vendor])

  async function save() {
    if (!name.trim()) {
      toast.error('Name required')
      return
    }
    setSaving(true)
    const payload = {
      name: name.trim(),
      type,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      address: address || null,
      notes: notes || null,
    }
    const res = vendor
      ? await api.patch(`/api/labs/vendors/${vendor.id}`, payload)
      : await api.post('/api/labs/vendors', payload)
    setSaving(false)
    if (res.success) {
      toast.success(vendor ? 'Updated' : 'Created')
      onSaved()
    } else toast.error((res.error as string) || 'Failed')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{vendor ? 'Edit' : 'New'} Lab Vendor</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lab name" />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as VendorType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="external">External</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
