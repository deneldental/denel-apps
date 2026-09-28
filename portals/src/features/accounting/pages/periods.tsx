import { toast } from 'sonner'
import { closePeriod, listPeriods, type Period, reopenPeriod } from '@/lib/actions/accounting'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

// Local query key — accounting has no matching group in `query-keys.ts`.
const PERIODS_KEY = ['accounting', 'periods'] as const

export default function PeriodsPage() {
  const periodsQuery = useApiQuery<Period[]>(PERIODS_KEY, () => listPeriods())
  const periods = periodsQuery.data ?? []
  const loading = periodsQuery.isLoading
  const error = periodsQuery.isError
    ? (periodsQuery.error?.message ?? 'Failed to load periods')
    : null

  const closeMutation = useApiMutation<Period, string>(closePeriod, {
    invalidates: [PERIODS_KEY],
    onSuccess: () => toast.success('Period closed'),
    onError: (err) => toast.error(err.message || 'Failed to close period'),
  })

  const reopenMutation = useApiMutation<Period, string>(reopenPeriod, {
    invalidates: [PERIODS_KEY],
    onSuccess: () => toast.success('Period reopened'),
    onError: (err) => toast.error(err.message || 'Admin access required to reopen'),
  })

  function onClose(id: string) {
    closeMutation.mutate(id)
  }

  function onReopen(id: string) {
    reopenMutation.mutate(id)
  }

  if (loading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (error) {
    return <div className="p-6 text-red-600">{error}</div>
  }

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Accounting Periods</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Closed periods reject new journal entries. Reopening is admin-only and audited.
        </p>
      </header>

      {periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">No periods yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-sm">{p.startDate}</TableCell>
                <TableCell className="text-sm">{p.endDate}</TableCell>
                <TableCell>
                  <Badge variant={p.status === 'open' ? 'default' : 'secondary'}>{p.status}</Badge>
                </TableCell>
                <TableCell>
                  {p.status === 'open' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={closeMutation.isPending && closeMutation.variables === p.id}
                      onClick={() => onClose(p.id)}
                    >
                      Close
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={reopenMutation.isPending && reopenMutation.variables === p.id}
                      onClick={() => onReopen(p.id)}
                    >
                      Reopen
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
