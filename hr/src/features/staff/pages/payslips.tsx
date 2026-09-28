import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@denel/ui'
import { type PayslipDocData, PayslipDocument } from '@denel/ui/blocks'
import { formatAmount } from '@denel/utils'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Download, Eye, Loader2, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { detailToDocData, type PayslipDetail } from '@/features/staff/lib/payslip-doc'
import { getPublicBranding, type PublicBranding } from '@/lib/actions/branding'
import {
  deletePayslip,
  relinkPayslip,
  rerunPayrollRun,
  unlinkPayslip,
} from '@/lib/actions/hr-phase2-4'
import { api } from '@/lib/api-client'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { StatusBadge } from '@/shared/components/status-badge'
import { useConfirm } from '@/shared/hooks/use-confirm'

interface PayslipRow {
  id: string
  staffId: string
  staffName: string | null
  staffCode: string | null
  payPeriod: string
  grossPay: string | null
  netPay: string | null
  status: 'draft' | 'published' | 'suspended'
  payrollRunId: string | null
  publishedAt: string | null
  fileUrl: string | null
  createdAt: string
}

function formatGhs(v: string | null): string {
  if (!v) return '—'
  return `GHS ${formatAmount(Number(v))}`
}

export default function PayslipsAdminPage() {
  const [rows, setRows] = useState<PayslipRow[]>([])
  const [loading, setLoading] = useState(true)
  const [branding, setBranding] = useState<PublicBranding | null>(null)
  const [printDoc, setPrintDoc] = useState<PayslipDocData | null>(null)
  const [viewDoc, setViewDoc] = useState<PayslipDocData | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  useEffect(() => {
    getPublicBranding().then((res) => {
      if (res.success && res.data) setBranding(res.data)
    })
  }, [])

  useEffect(() => {
    if (!printDoc) return
    const t = setTimeout(() => window.print(), 60)
    return () => clearTimeout(t)
  }, [printDoc])

  const loadPayslips = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<PayslipRow[]>('/api/staff/payslips')
      if (res.success && res.data) setRows(res.data)
      else toast.error(res.error || 'Failed to load payslips')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPayslips()
  }, [loadPayslips])

  const handleView = useCallback(
    async (id: string) => {
      const toastId = toast.loading('Loading payslip...')
      try {
        const res = await api.get<PayslipDetail>(`/api/payroll/payslips/${id}`)
        if (res.success && res.data) {
          setViewDoc(detailToDocData(res.data, branding))
          toast.dismiss(toastId)
        } else {
          toast.error(res.error || 'Failed to load payslip', { id: toastId })
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'An error occurred', { id: toastId })
      }
    },
    [branding]
  )

  const handleDownload = useCallback(
    (row: PayslipRow) => {
      if (row.fileUrl) {
        window.open(row.fileUrl, '_blank', 'noopener,noreferrer')
        return
      }
      const toastId = toast.loading('Preparing print view...')
      void (async () => {
        try {
          const res = await api.get<PayslipDetail>(`/api/payroll/payslips/${row.id}`)
          if (res.success && res.data) {
            setPrintDoc(detailToDocData(res.data, branding))
            toast.dismiss(toastId)
          } else {
            toast.error(res.error || 'Failed to load payslip', { id: toastId })
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'An error occurred', { id: toastId })
        }
      })()
    },
    [branding]
  )

  const handleUnlink = useCallback(
    async (row: PayslipRow) => {
      if (!row.payrollRunId) return
      const ok = await confirm({
        title: 'Unlink payslip',
        description:
          'This marks the payslip as suspended and removes its totals from the payroll run.',
        confirmLabel: 'Unlink',
        tone: 'default',
      })
      if (!ok) return
      const res = await unlinkPayslip(row.id)
      if (res.success) {
        toast.success('Payslip unlinked and suspended.')
        await loadPayslips()
      } else {
        toast.error(res.error || 'Failed to unlink payslip')
      }
    },
    [confirm, loadPayslips]
  )

  const handleLink = useCallback(
    async (row: PayslipRow) => {
      if (row.payrollRunId || row.status !== 'suspended') return
      const ok = await confirm({
        title: 'Link payslip',
        description:
          'This will re-attach the payslip to the draft payroll run for its period and trigger a recalculation.',
        confirmLabel: 'Link',
        tone: 'default',
      })
      if (!ok) return

      const toastId = toast.loading('Linking payslip...')
      try {
        const res = await relinkPayslip(row.id)
        if (res.success && res.data?.payrollRunId) {
          toast.loading('Recalculating payroll run...', { id: toastId })
          const rerunRes = await rerunPayrollRun(res.data.payrollRunId)
          if (rerunRes.success) {
            toast.success('Payslip linked and payroll run recalculated.', { id: toastId })
            await loadPayslips()
          } else {
            toast.error(
              rerunRes.error || 'Payslip linked, but failed to recalculate payroll run.',
              { id: toastId }
            )
            await loadPayslips()
          }
        } else {
          toast.error(res.error || 'Failed to link payslip', { id: toastId })
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'An error occurred while linking.', {
          id: toastId,
        })
      }
    },
    [confirm, loadPayslips]
  )

  const handleDelete = useCallback(
    async (row: PayslipRow) => {
      const ok = await confirm({
        title: 'Delete payslip',
        description:
          'Are you sure you want to permanently delete this suspended payslip? This action cannot be undone.',
        confirmLabel: 'Delete',
        tone: 'destructive',
      })
      if (!ok) return
      const res = await deletePayslip(row.id)
      if (res.success) {
        toast.success('Payslip permanently deleted.')
        await loadPayslips()
      } else {
        toast.error(res.error || 'Failed to delete payslip')
      }
    },
    [confirm, loadPayslips]
  )

  const columns = useMemo<ColumnDef<PayslipRow>[]>(
    () => [
      {
        accessorKey: 'staffName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Staff" />,
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-sm text-foreground">
              {row.original.staffName ?? '(Unknown staff)'}
            </p>
            {row.original.staffCode && (
              <p className="text-xs text-muted-foreground">{row.original.staffCode}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'payPeriod',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Period" />,
        cell: ({ row }) => {
          if (!row.original.payPeriod) return '—'
          return format(new Date(`${row.original.payPeriod}T00:00:00`), 'MMMM yyyy')
        },
      },
      {
        accessorKey: 'grossPay',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Gross Pay" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-sm font-medium text-slate-700 dark:text-slate-300">
            {formatGhs(row.original.grossPay)}
          </span>
        ),
      },
      {
        accessorKey: 'netPay',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Net Pay" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-sm font-bold text-emerald-600 dark:text-emerald-400">
            {formatGhs(row.original.netPay)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More options">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleView(row.original.id)}>
                <Eye className="mr-2 h-4 w-4" />
                View
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload(row.original)}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </DropdownMenuItem>
              {row.original.payrollRunId && row.original.status !== 'suspended' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleUnlink(row.original)}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Unlink
                  </DropdownMenuItem>
                </>
              )}
              {!row.original.payrollRunId && row.original.status === 'suspended' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleLink(row.original)}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Link & Rerun
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleDelete(row.original)}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [handleView, handleUnlink, handleDownload, handleLink, handleDelete]
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <style>{`
        #payslip-print-root { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          #payslip-print-root { display: block !important; position: fixed; inset: 0; }
          #payslip-print-root, #payslip-print-root * { visibility: visible !important; }
        }
        @page { margin: 12mm; }
      `}</style>
      <div id="payslip-print-root">{printDoc && <PayslipDocument data={printDoc} />}</div>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payslips</h1>
          <p className="text-muted-foreground mt-1">
            Historical read-only ledger of all generated payslips.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All payslips</CardTitle>
          <CardDescription>
            View, download, or unlink historical payslips. Staff see only published payslips.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <DataTable columns={columns} data={rows} />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewDoc} onOpenChange={(open) => !open && setViewDoc(null)}>
        <DialogContent className="max-w-4xl overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Payslip preview</DialogTitle>
            <DialogDescription>
              Review the payslip before printing or downloading.
            </DialogDescription>
          </DialogHeader>
          {viewDoc && <PayslipDocument data={viewDoc} />}
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  )
}
