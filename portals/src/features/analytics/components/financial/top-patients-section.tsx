import { Link } from 'react-router-dom'
import { getTopPatients } from '@/lib/actions/financial-analytics'
import { useApiQuery } from '@/lib/query'
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

const TOP_PATIENTS_KEY = (year: number, limit: number) =>
  ['analytics', 'financial', 'top-patients', year, limit] as const

export function TopPatientsSection({ year, limit = 10 }: { year: number; limit?: number }) {
  const query = useApiQuery(TOP_PATIENTS_KEY(year, limit), () => getTopPatients(year, limit))
  const rows = query.data ?? []
  const loading = query.isLoading

  return (
    <SectionCard title={`Top ${limit} Patients by Revenue`}>
      {loading ? (
        <Skeleton className="h-[200px] w-full" />
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No revenue this year</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">#</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead className="text-right">Payments</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p, i) => (
              <TableRow key={p.patient_id}>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/patients/${p.patient_id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                  {p.patient_code && (
                    <span className="ml-2 text-xs text-muted-foreground font-mono">
                      {p.patient_code}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm">{p.payment_count}</TableCell>
                <TableCell className="text-right text-sm font-semibold">{GHS(p.revenue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  )
}
