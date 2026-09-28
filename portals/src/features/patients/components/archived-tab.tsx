// Ledger → Archived sub-tab. One datatable, two underlying sources
// (archived invoices + archived payment plans), narrowed via the Type
// filter. Restore reactivates a row; Permanent delete is admin-only and
// requires the admin to re-type their password.
//
// We do NOT show migration-archived invoices here (those have
// `archivedBy = NULL` — Phase-5 superseded child installments). The
// backend's `/archived` endpoints already filter them out.

import { format } from 'date-fns'
import { Archive as ArchiveIcon, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type ArchivedInvoice,
  listArchivedInvoices,
  permanentlyDeleteInvoice,
  unarchiveInvoice,
} from '@/lib/actions/invoices-v2'
import {
  getArchivedPaymentPlansByPatient,
  permanentlyDeletePaymentPlan,
  unarchivePaymentPlan,
} from '@/lib/actions/payment-plans'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { AdminPasswordDialog } from '@/shared/components/ui/admin-password-dialog'
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
import { formatCurrencyCompact } from '@/shared/utils/currency'

interface ArchivedTabProps {
  patientId: string
  isAdmin: boolean
}

type ArchivedPlan = {
  id: string
  planNumber: string | null
  type: string
  status: string
  totalAmount: number | string
  archivedAt: string | null
  template?: { name: string } | null
}

type Row =
  | {
      kind: 'invoice'
      id: string
      identifier: string
      status: string
      total: number
      archivedAt: string | null
      raw: ArchivedInvoice
    }
  | {
      kind: 'plan'
      id: string
      identifier: string
      status: string
      total: number
      archivedAt: string | null
      raw: ArchivedPlan
    }

type DeleteTarget = { kind: 'invoice' | 'plan'; id: string; label: string }
type TypeFilter = 'all' | 'invoice' | 'plan'

export function ArchivedTab({ patientId, isAdmin }: ArchivedTabProps) {
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  const ARCHIVED_KEY = queryKeys.patients.archived(patientId)
  const archivedQuery = useApiQuery<{ invoices: ArchivedInvoice[]; plans: ArchivedPlan[] }>(
    ARCHIVED_KEY,
    async () => {
      const [invRes, planRes] = await Promise.all([
        listArchivedInvoices(patientId),
        getArchivedPaymentPlansByPatient(patientId),
      ])
      if (!invRes.success) {
        return { success: false, error: invRes.error || 'Failed to load archived invoices' }
      }
      return {
        success: true,
        data: {
          invoices: invRes.data,
          plans: planRes.success && planRes.data ? (planRes.data as ArchivedPlan[]) : [],
        },
      }
    }
  )
  const invoices = archivedQuery.data?.invoices ?? []
  const plans = archivedQuery.data?.plans ?? []
  const loading = archivedQuery.isLoading
  const error = archivedQuery.isError ? archivedQuery.error.message : null

  const unarchiveInvoiceMutation = useApiMutation((id: string) => unarchiveInvoice(id), {
    invalidates: [ARCHIVED_KEY],
  })
  const unarchivePlanMutation = useApiMutation((id: string) => unarchivePaymentPlan(id), {
    invalidates: [ARCHIVED_KEY],
  })
  const deleteInvoiceMutation = useApiMutation(
    (vars: { id: string; password: string }) => permanentlyDeleteInvoice(vars.id, vars.password),
    { invalidates: [ARCHIVED_KEY] }
  )
  const deletePlanMutation = useApiMutation(
    (vars: { id: string; password: string }) =>
      permanentlyDeletePaymentPlan(vars.id, vars.password),
    { invalidates: [ARCHIVED_KEY] }
  )

  // Build one unified row list from both sources, then filter by type. Sorted
  // by archivedAt DESC so newly-archived items surface to the top regardless
  // of which underlying table they came from.
  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      ...invoices.map(
        (inv): Row => ({
          kind: 'invoice',
          id: inv.id,
          identifier: inv.invoiceNumber,
          status: String(inv.status),
          total: Number(inv.total),
          archivedAt: inv.archivedAt,
          raw: inv,
        })
      ),
      ...plans.map(
        (p): Row => ({
          kind: 'plan',
          id: p.id,
          identifier: p.planNumber ?? `PLAN-${p.id.slice(0, 8)}`,
          status: p.status,
          total: Number(p.totalAmount),
          archivedAt: p.archivedAt,
          raw: p,
        })
      ),
    ]
    const filtered = typeFilter === 'all' ? all : all.filter((r) => r.kind === typeFilter)
    return filtered.sort((a, b) => {
      const at = a.archivedAt ? new Date(a.archivedAt).getTime() : 0
      const bt = b.archivedAt ? new Date(b.archivedAt).getTime() : 0
      return bt - at
    })
  }, [invoices, plans, typeFilter])

  async function handleRestore(row: Row) {
    try {
      if (row.kind === 'invoice') await unarchiveInvoiceMutation.mutateAsync(row.id)
      else await unarchivePlanMutation.mutateAsync(row.id)
      toast.success(`${row.kind === 'invoice' ? 'Invoice' : 'Plan'} ${row.identifier} restored`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore')
    }
  }

  async function handlePermanentDelete(password: string): Promise<void> {
    if (!deleteTarget) throw new Error('Nothing selected')
    if (deleteTarget.kind === 'invoice') {
      await deleteInvoiceMutation.mutateAsync({ id: deleteTarget.id, password })
    } else {
      await deletePlanMutation.mutateAsync({ id: deleteTarget.id, password })
    }
    toast.success(`${deleteTarget.label} permanently deleted`)
    setDeleteTarget(null)
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <div className="mb-2">{error}</div>
        <Button size="sm" variant="outline" onClick={() => archivedQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const totalCount = invoices.length + plans.length

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
        Archived items stay in the database but are hidden from active lists, reports, and balances.{' '}
        <strong>Restore</strong> brings them back; <strong>Permanent delete</strong> (admin only,
        requires password) removes them for good.
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {totalCount === 0
            ? 'No archived items'
            : `${rows.length} of ${totalCount} archived ${totalCount === 1 ? 'item' : 'items'}`}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Type</span>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
            <SelectTrigger className="h-8 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({totalCount})</SelectItem>
              <SelectItem value="invoice">Invoices ({invoices.length})</SelectItem>
              <SelectItem value="plan">Payment plans ({plans.length})</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <ArchiveIcon className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="font-medium text-muted-foreground">
              {totalCount === 0
                ? 'Nothing archived'
                : `No archived ${typeFilter === 'invoice' ? 'invoices' : 'payment plans'}`}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Archived invoices and payment plans show up here. Restore them with one click —
              permanent deletion requires the admin password.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Type</TableHead>
                <TableHead>Identifier</TableHead>
                <TableHead>Status at archive</TableHead>
                <TableHead>Archived</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-[200px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.kind}:${row.id}`}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-4 px-1.5 capitalize ${
                        row.kind === 'invoice'
                          ? 'border-sky-300 text-sky-700 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-300'
                          : 'border-violet-300 text-violet-700 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-300'
                      }`}
                    >
                      {row.kind === 'invoice' ? 'Invoice' : 'Plan'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold">
                    {row.identifier}
                    {row.kind === 'plan' && row.raw.template?.name && (
                      <span className="block text-[10px] font-normal text-muted-foreground truncate max-w-[200px]">
                        {row.raw.template.name}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1.5 capitalize text-muted-foreground"
                    >
                      {row.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {row.archivedAt ? format(new Date(row.archivedAt), 'MMM d, yyyy') : '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatCurrencyCompact(row.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleRestore(row)}>
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Restore
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!isAdmin}
                        title={
                          isAdmin
                            ? 'Permanently delete (requires password)'
                            : 'Only admins can permanently delete'
                        }
                        onClick={() =>
                          setDeleteTarget({
                            kind: row.kind,
                            id: row.id,
                            label:
                              row.kind === 'invoice'
                                ? `Invoice ${row.identifier}`
                                : `Plan ${row.identifier}`,
                          })
                        }
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AdminPasswordDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={deleteTarget ? `Permanently delete ${deleteTarget.label}?` : 'Permanently delete?'}
        description={
          deleteTarget?.kind === 'invoice'
            ? 'This wipes the invoice row and all of its line items + allocations from the database. There is no undo. Type your admin password to confirm.'
            : 'This wipes the plan row and its schedule items from the database. There is no undo. Type your admin password to confirm.'
        }
        onConfirm={handlePermanentDelete}
      />
    </div>
  )
}
