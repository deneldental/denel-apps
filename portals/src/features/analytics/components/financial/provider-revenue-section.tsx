import { getProviderRevenue } from '@/lib/actions/financial-analytics'
import { useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { GHS, SectionCard } from './shared'

const PROVIDER_REVENUE_KEY = (year: number) =>
  ['analytics', 'financial', 'provider-revenue', year] as const

/**
 * Revenue contributed by each clinical provider (doctor or visiting specialist).
 * Derived from invoice_lines.line_total grouped by providerId / specialistId —
 * which means lines without an attributed provider are excluded.
 */
export function ProviderRevenueSection({ year }: { year: number }) {
  const query = useApiQuery(PROVIDER_REVENUE_KEY(year), () => getProviderRevenue(year))
  const data = query.data ?? null
  const loading = query.isLoading

  return (
    <SectionCard title="Revenue by Provider">
      {loading ? (
        <Skeleton className="h-[200px] w-full" />
      ) : !data || data.providers.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No provider-attributed revenue this year.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {data.totals.providerCount} providers · {GHS(data.totals.revenue)} attributed
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">#</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.providers.map((p, i) => (
                <TableRow key={`${p.provider_type}-${p.provider_id}`}>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {i + 1}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{p.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {p.provider_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">{p.line_count}</TableCell>
                  <TableCell className="text-right text-sm font-semibold">
                    {GHS(p.revenue)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {p.percentage}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </SectionCard>
  )
}
