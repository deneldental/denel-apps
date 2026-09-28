import { PackageSearch } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type CatalogItem, getItems } from '@/lib/actions/items'
import { useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { formatAmount } from '@/shared/utils/currency'

const ghs = (v: number | string | null) =>
  v === null || v === undefined ? '—' : `GHS ${formatAmount(Number(v))}`

type CapKey = 'all' | 'sellable' | 'consumable' | 'Prescription' | 'lab'

const TABS: { key: CapKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sellable', label: 'Sellable' },
  { key: 'consumable', label: 'Consumable' },
  { key: 'Prescription', label: 'Prescription' },
  { key: 'lab', label: 'Lab' },
]

export default function CatalogPage() {
  const { isAdmin, isLoading: permsLoading, hasPermission } = usePermissions()
  // Gate the catalog tabs on the write grant, not on the admin role: reception
  // carries `items:*` precisely so they own day-to-day stock, and read-only
  // roles (doctors, via bundle_inventory_read) still land on Prescription.
  const canManageCatalog = isAdmin || hasPermission('items', 'update')
  const [q, setQ] = useState('')
  const [activeTab, setActiveTab] = useState<CapKey>('all')

  useEffect(() => {
    if (!permsLoading && !canManageCatalog) {
      setActiveTab('Prescription')
    }
  }, [permsLoading, canManageCatalog])

  const availableTabs = useMemo(() => {
    return canManageCatalog ? TABS : TABS.filter((t) => t.key === 'Prescription')
  }, [canManageCatalog])

  const { data: items = [], isLoading: loading } = useApiQuery(['catalog', 'items'], () =>
    getItems()
  )

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return items
    return items.filter(
      (i) => i.name.toLowerCase().includes(term) || (i.sku ?? '').toLowerCase().includes(term)
    )
  }, [items, q])

  const by = useCallback(
    (cap: CapKey) => (cap === 'all' ? filtered : filtered.filter((i) => i[cap])),
    [filtered]
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <PackageSearch className="h-7 w-7" /> Catalog
          </h1>
          <p className="mt-1 text-muted-foreground">
            Unified view of every item (retail + clinical). Edit items under Products / Inventory
            during the migration.
          </p>
        </div>
        <Input
          placeholder="Search name or SKU…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64"
        />
      </div>

      {loading || permsLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CapKey)}>
          <TabsList>
            {availableTabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  {by(t.key).length}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
          {availableTabs.map((t) => (
            <TabsContent key={t.key} value={t.key} className="mt-4">
              <CatalogTable rows={by(t.key)} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}

function CatalogTable({ rows }: { rows: CatalogItem[] }) {
  if (rows.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">No items.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Capabilities</TableHead>
          <TableHead className="text-right">Stock</TableHead>
          <TableHead className="text-right">Price</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((i) => {
          const low = i.stockQuantity <= (i.reorderLevel ?? 10)
          return (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.name}</TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {i.sku ?? '—'}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{i.category ?? '—'}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {i.sellable && (
                    <Badge variant="outline" className="text-[10px]">
                      Sellable
                    </Badge>
                  )}
                  {i.consumable && (
                    <Badge variant="outline" className="text-[10px]">
                      Consumable
                    </Badge>
                  )}
                  {i.Prescription && (
                    <Badge variant="outline" className="text-[10px]">
                      Prescription
                    </Badge>
                  )}
                  {i.lab && (
                    <Badge variant="outline" className="text-[10px]">
                      Lab
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <span className={low ? 'font-medium text-amber-600' : ''}>{i.stockQuantity}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{ghs(i.price)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
