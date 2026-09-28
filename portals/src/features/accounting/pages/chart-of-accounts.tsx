import { type Account, listAccounts } from '@/lib/actions/accounting'
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

const TYPE_ORDER: Account['type'][] = ['asset', 'liability', 'equity', 'revenue', 'expense']
const TYPE_LABEL: Record<Account['type'], string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
}

// Local query key — accounting has no matching group in `query-keys.ts`.
const ACCOUNTS_KEY = ['accounting', 'accounts'] as const

export default function ChartOfAccountsPage() {
  const accountsQuery = useApiQuery<Account[]>(ACCOUNTS_KEY, () => listAccounts())
  const accounts = accountsQuery.data ?? []
  const loading = accountsQuery.isLoading
  const error = accountsQuery.isError
    ? (accountsQuery.error?.message ?? 'Failed to load accounts')
    : null

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

  const grouped = TYPE_ORDER.map((type) => ({
    type,
    rows: accounts.filter((a) => a.type === type),
  }))

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {accounts.length} accounts across {TYPE_ORDER.length} types. Control accounts (AR, AP,
          Patient Deposits, Commission Payable) are tracked per-party in the matching sub-ledger.
        </p>
      </header>

      {grouped.map(({ type, rows }) => (
        <section key={type} className="space-y-2">
          <h2 className="text-lg font-medium">{TYPE_LABEL[type]}</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Subtype</TableHead>
                  <TableHead>Normal Balance</TableHead>
                  <TableHead>Control</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id} className={!a.isActive ? 'opacity-50' : undefined}>
                    <TableCell className="font-mono text-sm">{a.code}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.subtype ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.normalBalance === 'debit' ? 'secondary' : 'outline'}>
                        {a.normalBalance.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {a.isControl ? (
                        <Badge>{a.controlPartyType}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      ))}
    </div>
  )
}
