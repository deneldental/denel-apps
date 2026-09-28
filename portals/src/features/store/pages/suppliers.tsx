import { Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useCan } from '@/lib/permissions-context'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { AddSupplierSheet } from '../components/add-supplier-sheet'

type Supplier = {
  id: string
  name: string
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  paymentTerms: string | null
  notes: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export default function SuppliersListPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  // Supplier master data is finance-owned. Inventory holders (the front desk)
  // can read this list — Receive Stock picks from it — but not edit it.
  const canManageSuppliers = useCan('suppliers', 'create')

  const loadSuppliers = useCallback(async () => {
    const res = await api.get<Supplier[]>('/api/suppliers')
    if (res.success && res.data) {
      setSuppliers(res.data)
    } else {
      toast.error('Failed to load suppliers')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadSuppliers()
  }, [loadSuppliers])

  const filtered = useMemo<Supplier[]>(() => {
    if (!query.trim()) return suppliers
    const q = query.trim().toLowerCase()
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.contactPhone ?? '').toLowerCase().includes(q) ||
        (s.contactEmail ?? '').toLowerCase().includes(q)
    )
  }, [suppliers, query])

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage vendor contacts, contracts and pricing references.
          </p>
        </div>
        {canManageSuppliers && (
          <>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Supplier
            </Button>
            <AddSupplierSheet open={addOpen} onOpenChange={setAddOpen} onAdded={loadSuppliers} />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1 flex-1 min-w-[240px]">
          <p className="text-xs text-muted-foreground">Search</p>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Name, phone or email…"
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Payment Terms</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    Loading suppliers…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    {suppliers.length === 0
                      ? 'No suppliers yet. Add your first supplier.'
                      : 'No suppliers match the search.'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-muted/40">
                    <TableCell>
                      <Link to={`/inventory/suppliers/${s.id}`} className="font-medium">
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm font-mono">{s.contactPhone ?? '—'}</TableCell>
                    <TableCell className="text-sm">{s.contactEmail ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.paymentTerms ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={s.active ? 'default' : 'secondary'}>
                        {s.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
