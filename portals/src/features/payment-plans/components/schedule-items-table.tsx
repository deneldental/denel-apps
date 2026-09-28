import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  getPlanSchedule,
  recomputePlanSchedule,
  type ScheduleItem,
} from '@/lib/actions/payment-plans-v2'
import { useApiQuery } from '@/lib/query'
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

type Props = {
  planId: string
  scheduleType?: string
}

const STATUS_VARIANTS: Record<
  ScheduleItem['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  paid: 'default',
  partial: 'secondary',
  overdue: 'destructive',
  pending: 'outline',
  waived: 'outline',
}

export function ScheduleItemsTable({ planId, scheduleType }: Props) {
  const [busy, setBusy] = useState(false)

  const scheduleQuery = useApiQuery<ScheduleItem[]>(queryKeys.paymentPlans.schedule(planId), () =>
    getPlanSchedule(planId)
  )
  const items = scheduleQuery.data ?? []
  const loading = scheduleQuery.isLoading

  async function onRecompute() {
    setBusy(true)
    const res = await recomputePlanSchedule(planId)
    setBusy(false)
    if (!res.success) return toast.error(res.error ?? 'Failed to recompute')
    toast.success('Schedule recomputed')
    scheduleQuery.refetch()
  }

  // Flexible plans have no schedule. Hide entirely.
  if (scheduleType === 'flexible') return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Installment schedule</CardTitle>
          <CardDescription>
            Status is derived from cumulative payments against the master invoice. Recompute if a
            payment was just posted and you don't see it reflected.
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={onRecompute} disabled={busy}>
          <RotateCw className="size-4 mr-1" /> Recompute
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No schedule items.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead className="text-right">Amount due</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.sequence}</TableCell>
                  <TableCell className="text-sm">{i.expectedDate}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(i.expectedAmount)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {i.amountReceived > 0 ? formatCurrency(i.amountReceived) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[i.status]}>{i.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
