import { CheckCircle2, RotateCw, XCircle } from 'lucide-react'
import { type FinanceHealth, getFinanceHealth } from '@/lib/actions/accounting'
import { useApiQuery } from '@/lib/query'
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

/**
 * Coerce a backend-supplied money string to a number, defaulting to 0 for
 * null/undefined/non-numeric input. `ReconciliationDrift` types these fields
 * as `string`, so a bare `Number()` could render "GHS NaN" (remediation M29).
 */
function safeNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Local query key — accounting has no matching group in `query-keys.ts`.
const FINANCE_HEALTH_KEY = ['accounting', 'finance-health'] as const

export default function FinanceHealthPage() {
  const healthQuery = useApiQuery<FinanceHealth>(FINANCE_HEALTH_KEY, () => getFinanceHealth())
  const data = healthQuery.data ?? null
  const loading = healthQuery.isLoading
  const refreshing = healthQuery.isFetching
  const error = healthQuery.isError ? (healthQuery.error?.message ?? 'Failed to load') : null

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Finance health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sub-ledger reconciliation: every control account in the GL is compared against its
            sub-ledger total. Drift &gt; 0.005 GHS is flagged. Spec §8.12.
          </p>
        </div>
        <Button variant="outline" onClick={() => healthQuery.refetch()} disabled={refreshing}>
          <RotateCw className="size-4 mr-1" />
          {refreshing ? 'Running…' : 'Re-run'}
        </Button>
      </header>

      {error && <p className="text-red-600">{error}</p>}

      {loading && !data ? (
        <Skeleton className="h-48 w-full" />
      ) : data ? (
        <>
          <Card className={data.ok ? 'border-emerald-600' : 'border-red-600'}>
            <CardHeader>
              <div className="flex items-center gap-2">
                {data.ok ? (
                  <CheckCircle2 className="size-6 text-emerald-600" />
                ) : (
                  <XCircle className="size-6 text-red-600" />
                )}
                <CardTitle>{data.ok ? 'All sub-ledgers reconcile' : 'Drift detected'}</CardTitle>
              </div>
              <CardDescription>Last run {new Date(data.ranAt).toLocaleString()}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                {data.ok
                  ? 'Every control account matches its sub-ledger to the cent. The GL is healthy.'
                  : `${data.drifts.length} control account${data.drifts.length === 1 ? '' : 's'} are out of sync with their sub-ledger.`}
              </p>
              {data.unbalancedEntries.length > 0 && (
                <p className="text-sm text-red-600 mt-2">
                  ⚠ {data.unbalancedEntries.length} journal entr
                  {data.unbalancedEntries.length === 1 ? 'y has' : 'ies have'} unbalanced debits and
                  credits.
                </p>
              )}
            </CardContent>
          </Card>

          {data.drifts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Drift detail</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Code</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">GL balance</TableHead>
                      <TableHead className="text-right">Sub-ledger</TableHead>
                      <TableHead className="text-right">Drift</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.drifts.map((d) => (
                      <TableRow key={d.accountCode}>
                        <TableCell className="font-mono text-sm">{d.accountCode}</TableCell>
                        <TableCell>{d.accountName}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(safeNumber(d.glBalance))}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(safeNumber(d.subledgerBalance))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="destructive" className="font-mono">
                            {formatCurrency(safeNumber(d.drift))}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  )
}
