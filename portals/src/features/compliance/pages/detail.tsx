import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { ArrowLeft, ExternalLink, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ComplianceRenewalSheet } from '@/features/compliance/components/compliance-renewal-sheet'
import { deriveStatus, StatusBadge } from '@/features/compliance/pages/index'
import { getComplianceDocument } from '@/lib/actions/compliance'
import { useApiQuery } from '@/lib/query'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { formatAmount } from '@/shared/utils/currency'

/** Local key — a single compliance document detail, not read anywhere else. */
const complianceDocumentKey = (id: string) => ['compliance', 'document', id] as const

export default function ComplianceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [showRenewal, setShowRenewal] = useState(false)

  const docQuery = useApiQuery(
    complianceDocumentKey(id ?? 'none'),
    () => getComplianceDocument(id as string),
    { enabled: !!id }
  )
  const doc = docQuery.data ?? null
  const loading = docQuery.isLoading

  const renewals = doc?.renewals ?? []

  const table = useReactTable({
    data: renewals,
    columns: [
      {
        accessorKey: 'uploadedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => {
          const val = row.getValue('uploadedAt') as string
          return new Date(val).toLocaleDateString()
        },
      },
      {
        accessorKey: 'expiryDate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="New Expiry" />,
        cell: ({ row }) => {
          const val = row.getValue('expiryDate') as string
          return new Date(val).toLocaleDateString()
        },
      },
      {
        accessorKey: 'amountPaid',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount Paid" />,
        cell: ({ row }) => {
          const val = row.getValue('amountPaid')
          return val ? `GH₵ ${formatAmount(Number(val))}` : '—'
        },
      },
      {
        accessorKey: 'notes',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Notes" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.getValue('notes') || '—'}</span>
        ),
      },
      {
        id: 'links',
        header: 'Attachments',
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex items-center gap-3">
              {r.documentUrl && (
                <a
                  href={r.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline flex items-center gap-1 text-sm"
                >
                  Document <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {r.receiptUrl && (
                <a
                  href={r.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline flex items-center gap-1 text-sm"
                >
                  Receipt <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )
        },
      },
    ],
    getCoreRowModel: getCoreRowModel(),
  })

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading document details...</div>
  }

  if (!doc) {
    return <div className="p-8 text-center text-destructive">Document not found.</div>
  }

  const currentStatus = deriveStatus(doc.dateExpired)

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          to="/compliance"
          className="hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Compliance
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{doc.documentName}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{doc.documentName}</h1>
          <p className="text-muted-foreground mt-1">
            Category: <span className="capitalize">{doc.category}</span>
            {doc.issuingAuthority && ` • Authority: ${doc.issuingAuthority}`}
          </p>
        </div>
        <StatusBadge status={currentStatus} />
      </div>

      {/* Details Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current Status</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Date Issued</p>
            <p>{doc.dateIssued ? new Date(doc.dateIssued).toLocaleDateString() : '—'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Expiry Date</p>
            <p>{doc.dateExpired ? new Date(doc.dateExpired).toLocaleDateString() : '—'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Reminders</p>
            <p>
              {doc.reminderEnabled ? `Yes (${doc.reminderMonthsBefore} mo before)` : 'Disabled'}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Document File</p>
            {doc.documentUrl ? (
              <a
                href={doc.documentUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                View PDF <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <p>—</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Renewals Table */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Renewal History</h2>
          <Button onClick={() => setShowRenewal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Renew Document
          </Button>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No renewals recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ComplianceRenewalSheet
        open={showRenewal}
        onOpenChange={setShowRenewal}
        documentId={doc.id}
        onSaved={() => void docQuery.refetch()}
      />
    </div>
  )
}
