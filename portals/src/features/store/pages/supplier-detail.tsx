import { useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import {
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  createSupplierDocument,
  deleteSupplierDocument,
  getSupplierDocuments,
  type SupplierDocument,
} from '@/lib/actions/supplier-documents'
import {
  createSupplierPriceItem,
  getSupplierPricing,
  type SupplierPriceItem,
} from '@/lib/actions/supplier-pricing'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Switch } from '@/shared/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { formatCurrency } from '@/shared/utils/currency'
import { AddPriceSheet, EditSupplierSheet } from '../components/edit-supplier-sheet'
import type { SupplierDetail } from '../types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Number(kb).toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

// No shared query-key group exists for a single supplier's own record,
// documents or pricing — local literals, module-scoped, shared by the reads
// below and the cache writes in the mutation handlers.
const supplierKey = (id: string) => ['suppliers', id] as const
const supplierDocsKey = (id: string) => ['suppliers', id, 'documents'] as const
const supplierPricingKey = (id: string) => ['suppliers', id, 'pricing'] as const

export default function SupplierDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [editOpen, setEditOpen] = useState(false)
  const [addPriceOpen, setAddPriceOpen] = useState(false)

  const { data: supplier, isLoading: loadingSupplier } = useApiQuery(supplierKey(id), () =>
    api.get<SupplierDetail>(`/api/suppliers/${id}`)
  )

  // Reuses the shared inventory list cache — the same unfiltered `/api/inventory`
  // read every other inventory screen uses — and narrows to this supplier's
  // items client-side, same as before.
  const { data: allInventoryItems = [], isLoading: loadingInventory } = useApiQuery(
    queryKeys.inventory.list(),
    () => api.get<any[]>('/api/inventory')
  )
  const inventoryItems = allInventoryItems.filter((item: any) => item.supplierId === id)

  const { data: documents = [], isLoading: loadingDocs } = useApiQuery(supplierDocsKey(id), () =>
    getSupplierDocuments(id)
  )

  const { data: priceItems = [], isLoading: loadingPrices } = useApiQuery(
    supplierPricingKey(id),
    () => getSupplierPricing(id)
  )

  if (loadingSupplier) {
    return <div className="p-6 text-center text-muted-foreground">Loading supplier…</div>
  }

  if (!supplier) {
    return (
      <div className="p-6 space-y-3 text-center">
        <p className="text-lg font-medium">Supplier not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/inventory/suppliers')}>
          Back to suppliers
        </Button>
      </div>
    )
  }

  // This used to flip local state and toast success without ever calling the
  // API — the switch reported a change the server never saw, and a refresh
  // silently reverted it. It now persists, and only updates the UI once the
  // write is acknowledged.
  const toggleActive = async () => {
    const next = !supplier.active
    const res = await api.patch<SupplierDetail>(`/api/suppliers/${supplier.id}`, {
      active: next,
    })
    if (!res.success) {
      toast.error(res.error || 'Failed to update supplier')
      return
    }
    queryClient.setQueryData<SupplierDetail>(supplierKey(supplier.id), (s) =>
      s ? { ...s, active: next } : s
    )
    toast.success(next ? 'Supplier reactivated' : 'Supplier deactivated')
  }

  const handleUpload = async () => {
    const res = await createSupplierDocument(supplier.id, {
      title: 'Untitled document',
      fileName: `document-${Date.now()}.pdf`,
      fileUrl: 'https://placehold.co/800x1000/png?text=Document',
      sizeBytes: 0,
    })
    if (res.success && res.data) {
      const created = res.data
      queryClient.setQueryData<SupplierDocument[]>(supplierDocsKey(supplier.id), (prev) => [
        created,
        ...(prev ?? []),
      ])
      toast.success('Document uploaded')
    } else {
      toast.error(res.error || 'Upload failed')
    }
  }

  const handleDeleteDocument = async (docId: string) => {
    const res = await deleteSupplierDocument(supplier.id, docId)
    if (res.success) {
      queryClient.setQueryData<SupplierDocument[]>(supplierDocsKey(supplier.id), (prev) =>
        (prev ?? []).filter((d) => d.id !== docId)
      )
      toast.success('Document removed')
    } else {
      toast.error(res.error || 'Failed to remove document')
    }
  }

  const handleSupplierSave = (updated: SupplierDetail) => {
    queryClient.setQueryData(supplierKey(updated.id), updated)
    setEditOpen(false)
  }

  const handleAddPrice = async (item: { itemName: string; unit: string; unitPrice: number }) => {
    const res = await createSupplierPriceItem(supplier.id, item)
    if (res.success && res.data) {
      const created = res.data
      queryClient.setQueryData<SupplierPriceItem[]>(supplierPricingKey(supplier.id), (prev) => [
        created,
        ...(prev ?? []),
      ])
      toast.success('Price item added')
    } else {
      toast.error(res.error || 'Failed to add price item')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <button
          type="button"
          className="hover:text-foreground hover:underline"
          onClick={() => navigate('/inventory')}
        >
          Inventory
        </button>
        <span className="mx-2">›</span>
        <button
          type="button"
          className="hover:text-foreground hover:underline"
          onClick={() => navigate('/inventory/suppliers')}
        >
          Suppliers
        </button>
        <span className="mx-2">›</span>
        <span className="font-medium text-foreground">{supplier.name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{supplier.name}</h1>
            <Badge variant={supplier.active ? 'default' : 'secondary'}>
              {supplier.active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          {supplier.paymentTerms && (
            <p className="mt-1 text-sm text-muted-foreground">{supplier.paymentTerms}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Active</span>
            <Switch checked={supplier.active} onCheckedChange={toggleActive} />
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="inventory">
            Inventory {inventoryItems.length > 0 && `(${inventoryItems.length})`}
          </TabsTrigger>
          <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
          <TabsTrigger value="pricing">Pricing ({priceItems.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <InfoRow icon={Phone} label="Phone" value={supplier.contactPhone} />
                <InfoRow icon={Mail} label="Email" value={supplier.contactEmail} />
                <InfoRow icon={MapPin} label="Address" value={supplier.address} />
                <InfoRow
                  icon={FileText}
                  label="Last order"
                  value={formatOrderDate(supplier.lastOrderAt)}
                />
              </div>
              {supplier.notes && (
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Notes
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{supplier.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingInventory ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : inventoryItems.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No inventory items linked to this supplier.
                      </TableCell>
                    </TableRow>
                  ) : (
                    inventoryItems.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="capitalize text-sm text-muted-foreground">
                          {item.category || '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.unit || '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {item.stockQuantity}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4 space-y-4">
          <Card
            className="border-dashed cursor-pointer hover:border-muted-foreground/50"
            onClick={handleUpload}
          >
            <CardContent className="p-6 flex flex-col items-center gap-2 text-center">
              <Upload className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-sm font-medium">Drop a file or click to upload</p>
              <p className="text-xs text-muted-foreground">
                Contracts, price lists, certifications — PDF, JPG, PNG
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingDocs ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-20 text-center text-muted-foreground text-sm"
                      >
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : documents.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-20 text-center text-muted-foreground text-sm"
                      >
                        No documents yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    documents.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.title}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {d.fileName}
                        </TableCell>
                        <TableCell className="text-xs">{formatBytes(d.sizeBytes)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDistanceToNow(parseISO(d.createdAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                window.open(d.fileUrl, '_blank', 'noopener,noreferrer')
                              }
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteDocument(d.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pricing" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setAddPriceOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add price
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Last updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPrices ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-20 text-center text-muted-foreground text-sm"
                      >
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : priceItems.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-20 text-center text-muted-foreground text-sm"
                      >
                        No price items recorded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    priceItems.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.itemName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.unit}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatCurrency(p.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {format(parseISO(p.updatedAt), 'MMM d, yyyy')}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EditSupplierSheet
        supplier={supplier}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={handleSupplierSave}
      />
      <AddPriceSheet
        supplierId={supplier.id}
        open={addPriceOpen}
        onOpenChange={setAddPriceOpen}
        onAdd={handleAddPrice}
      />
    </div>
  )
}

/**
 * `lastOrderAt` is a `YYYY-MM-DD` date from the server (max non-void bill issue
 * date), or null for a supplier that has never been billed. Bad input renders
 * as "no order" rather than "Invalid Date".
 */
function formatOrderDate(value: string | null): string | null {
  if (!value) return null
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : format(parsed, 'MMM d, yyyy')
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | null
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-sm break-words">{value ?? '—'}</p>
      </div>
    </div>
  )
}
