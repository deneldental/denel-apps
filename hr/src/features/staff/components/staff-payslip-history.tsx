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
} from '@denel/ui'
import { type PayslipDocData, PayslipDocument } from '@denel/ui/blocks'
import { formatAmount } from '@denel/utils'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Download, Eye, FileText, Loader2, Printer } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { detailToDocData, type PayslipDetail } from '@/features/staff/lib/payslip-doc'
import { getPublicBranding, type PublicBranding } from '@/lib/actions/branding'
import { api } from '@/lib/api-client'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { StatusBadge } from '@/shared/components/status-badge'

interface PayslipRow {
  id: string
  staffId: string
  payPeriod: string
  grossPay: string | null
  netPay: string | null
  status: 'draft' | 'published' | 'suspended'
  publishedAt: string | null
  fileUrl: string | null
  createdAt: string
}

function formatGhs(v: string | null): string {
  if (!v) return '—'
  return `GHS ${formatAmount(Number(v))}`
}

function periodLabel(period: string): string {
  if (!period) return '—'
  const iso = period.length === 7 ? `${period}-01` : period
  try {
    return format(new Date(`${iso}T00:00:00`), 'MMMM yyyy')
  } catch {
    return period
  }
}

/**
 * Per-staff payslip history — a paginated table of every payslip generated for
 * this employee, for auditing and re-download. Sits under the Payslip Builder in
 * the Compensation tab. Rendering reuses the shared `detailToDocData` mapping so
 * a re-opened payslip looks identical to the admin Payslips page.
 */
export function PayslipHistoryCard({ staffId }: { staffId: string }) {
  const [rows, setRows] = useState<PayslipRow[]>([])
  const [loading, setLoading] = useState(true)
  const [branding, setBranding] = useState<PublicBranding | null>(null)
  const [viewDoc, setViewDoc] = useState<PayslipDocData | null>(null)
  const [printDoc, setPrintDoc] = useState<PayslipDocData | null>(null)

  useEffect(() => {
    getPublicBranding().then((res) => {
      if (res.success && res.data) setBranding(res.data)
    })
  }, [])

  // Print flow: stamp the doc into a hidden print root, then trigger the browser
  // print dialog (mirrors the admin Payslips page).
  useEffect(() => {
    if (!printDoc) return
    const t = setTimeout(() => window.print(), 60)
    return () => clearTimeout(t)
  }, [printDoc])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<PayslipRow[]>(`/api/staff/payslips?staffId=${staffId}`)
      if (res.success && res.data) setRows(res.data)
      else toast.error(res.error || 'Failed to load payslip history')
    } finally {
      setLoading(false)
    }
  }, [staffId])

  useEffect(() => {
    void load()
  }, [load])

  const openDoc = useCallback(
    async (id: string, mode: 'view' | 'print') => {
      const toastId = toast.loading('Loading payslip…')
      try {
        const res = await api.get<PayslipDetail>(`/api/payroll/payslips/${id}`)
        if (!res.success || !res.data) {
          toast.error(res.error || 'Failed to load payslip', { id: toastId })
          return
        }
        toast.dismiss(toastId)
        const doc = detailToDocData(res.data, branding)
        if (mode === 'print') setPrintDoc(doc)
        else setViewDoc(doc)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load payslip', { id: toastId })
      }
    },
    [branding]
  )

  const columns = useMemo<ColumnDef<PayslipRow>[]>(
    () => [
      {
        accessorKey: 'payPeriod',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Period" />,
        cell: ({ row }) => (
          <span className="font-medium">{periodLabel(row.original.payPeriod)}</span>
        ),
      },
      {
        accessorKey: 'grossPay',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Gross" className="justify-end" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{formatGhs(row.original.grossPay)}</span>
        ),
      },
      {
        accessorKey: 'netPay',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Net" className="justify-end" />
        ),
        cell: ({ row }) => (
          <span className="block text-right font-medium tabular-nums">
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
        accessorKey: 'publishedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Published" />,
        cell: ({ row }) =>
          row.original.publishedAt ? (
            <span className="text-sm text-muted-foreground">
              {format(new Date(row.original.publishedAt), 'dd MMM yyyy')}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openDoc(row.original.id, 'view')}
              aria-label="View payslip"
            >
              <Eye className="h-4 w-4" />
            </Button>
            {row.original.fileUrl ? (
              <Button variant="ghost" size="sm" asChild aria-label="Download payslip">
                <a href={row.original.fileUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="h-4 w-4" />
                </a>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openDoc(row.original.id, 'print')}
                aria-label="Print payslip"
              >
                <Printer className="h-4 w-4" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [openDoc]
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-1.5">
          <FileText className="h-4 w-4" />
          Payslip history
        </CardTitle>
        <CardDescription>
          Every payslip generated for this employee. View or re-download for auditing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No payslips generated yet.
          </p>
        ) : (
          <DataTable columns={columns} data={rows} />
        )}
      </CardContent>

      <Dialog open={!!viewDoc} onOpenChange={(open) => !open && setViewDoc(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payslip preview</DialogTitle>
            <DialogDescription>
              Review the payslip before printing or downloading.
            </DialogDescription>
          </DialogHeader>
          {viewDoc && <PayslipDocument data={viewDoc} />}
        </DialogContent>
      </Dialog>

      {/* Hidden print root — only visible to the print stylesheet. */}
      {printDoc && (
        <div className="hidden print:block">
          <PayslipDocument data={printDoc} />
        </div>
      )}
    </Card>
  )
}
