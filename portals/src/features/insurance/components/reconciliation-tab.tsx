import { format } from 'date-fns'
import { CheckCircle2, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
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
import { formatAmount } from '@/shared/utils/currency'
import type { InsuranceCompany, ReconciliationEntry } from '../types'
import { NewReconciliationSheet } from './new-reconciliation-sheet'
import { ReconcileEntrySheet } from './reconcile-entry-sheet'

interface Props {
  companies: InsuranceCompany[]
}

/**
 * Reconciliation entries table + filters.
 *
 * After M6 dialog->sheet pass, both the "new entry" form and the "mark
 * reconciled" form open as `<SheetFormLayout>` slide-overs (see siblings).
 */
export function ReconciliationTab({ companies }: Props) {
  const [entries, setEntries] = useState<ReconciliationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCompanyId, setFilterCompanyId] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [reconcilingEntry, setReconcilingEntry] = useState<ReconciliationEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterCompanyId !== 'all') params.set('companyId', filterCompanyId)
    if (filterStatus !== 'all') params.set('status', filterStatus)
    const qs = params.toString()
    const res = await api.get<ReconciliationEntry[]>(
      `/api/insurance/reconciliation${qs ? `?${qs}` : ''}`
    )
    if (res.success && res.data) {
      // numeric(15,2) columns arrive from the API as DECIMAL strings, not JS
      // numbers — coerce at this boundary so the `number` types hold and the
      // downstream `.toFixed()` calls (here + ReconcileEntrySheet) don't throw.
      setEntries(
        res.data.map((e) => ({
          ...e,
          chargedAmount: Number(e.chargedAmount),
          insurerPaidAmount: e.insurerPaidAmount == null ? null : Number(e.insurerPaidAmount),
        }))
      )
    }
    setLoading(false)
  }, [filterCompanyId, filterStatus])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Reconciliation Entries</h3>
          <p className="text-xs text-muted-foreground">
            Insurance-sourced treatments recorded in the clinic ledger.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New Entry
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterCompanyId} onValueChange={setFilterCompanyId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="reconciled">Reconciled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">No reconciliation entries yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Card #</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead className="text-right">Charged</TableHead>
                <TableHead className="text-right">Settled</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => {
                const reconciled = !!e.reconciledAt
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {(() => {
                        try {
                          return format(new Date(e.recordedAt), 'MMM d, yyyy')
                        } catch {
                          return e.recordedAt
                        }
                      })()}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{e.company?.name || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{e.cardNumber}</TableCell>
                    <TableCell className="text-sm">{e.patient?.name || '—'}</TableCell>
                    <TableCell className="text-right font-medium">
                      GHS {formatAmount(Number(e.chargedAmount))}
                    </TableCell>
                    <TableCell className="text-right font-medium text-emerald-600">
                      {e.insurerPaidAmount != null
                        ? `GHS ${formatAmount(Number(e.insurerPaidAmount))}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {reconciled ? (
                        <Badge variant="success" className="text-[10px]">
                          Reconciled
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-[10px]">
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!reconciled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setReconcilingEntry(e)}
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                          Reconcile
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <NewReconciliationSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        companies={companies}
        onSaved={() => {
          setCreateOpen(false)
          load()
        }}
      />
      {reconcilingEntry && (
        <ReconcileEntrySheet
          entry={reconcilingEntry}
          onClose={() => setReconcilingEntry(null)}
          onSaved={() => {
            setReconcilingEntry(null)
            load()
          }}
        />
      )}
    </div>
  )
}
