import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type BillStatus, listBills } from '@/lib/actions/bills'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { formatCurrency } from '@/shared/utils/currency'

const STATUS_VARIANT: Record<BillStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  posted: 'default',
  partially_paid: 'secondary',
  paid: 'default',
  void: 'destructive',
}

export default function BillsPage() {
  const [statusFilter, setStatusFilter] = useState<'all' | BillStatus>('all')
  const navigate = useNavigate()

  const {
    data: bills = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.bills.list(statusFilter),
    queryFn: async () => {
      const res = await listBills(statusFilter === 'all' ? undefined : { status: statusFilter })
      if (!res.success) throw new Error(res.error ?? 'Failed to load bills')
      return res.data
    },
  })

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Supplier bills</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track and post supplier invoices. Each bill writes DR expense / CR Accounts Payable
            (2000) to the GL when posted.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as 'all' | BillStatus)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="posted">Posted</SelectItem>
              <SelectItem value="partially_paid">Partially paid</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="void">Void</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => navigate('/bills/new')}>
            <Plus className="size-4 mr-1" /> New bill
          </Button>
        </div>
      </header>

      {isError && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>Failed to load bills.</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : bills.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bills.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Issue date</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-sm">{b.billNumber}</TableCell>
                <TableCell>{b.supplier?.name ?? '—'}</TableCell>
                <TableCell className="text-sm">{b.issueDate}</TableCell>
                <TableCell className="text-sm">{b.dueDate}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(b.total)}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(b.balance)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[b.status]}>{b.status}</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/bills/${b.id}`)}>
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
