import type { ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

interface SignedConsentRow {
  id: string
  patientId: string
  patientName: string | null
  templateId: string
  templateName: string | null
  consentType: string | null
  signedAt: string
  signedByName: string
}

export default function AllConsentsPage() {
  const [rows, setRows] = useState<SignedConsentRow[]>([])

  useEffect(() => {
    apiClient<SignedConsentRow[]>('/api/consent-forms/signed').then((res) => {
      if (res.success && res.data) setRows(res.data)
    })
  }, [])

  const columns = useMemo<ColumnDef<SignedConsentRow>[]>(
    () => [
      {
        accessorKey: 'patientName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Patient" />,
        cell: ({ row }) => (
          <span className="font-medium text-sm">{row.original.patientName ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'templateName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Template" />,
        cell: ({ row }) => <span className="text-sm">{row.original.templateName ?? '—'}</span>,
      },
      {
        accessorKey: 'consentType',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) =>
          row.original.consentType ? (
            <Badge variant="secondary" className="capitalize">
              {row.original.consentType}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: () => (
          <Badge variant="default" className="gap-1 bg-emerald-500 hover:bg-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> Signed
          </Badge>
        ),
      },
      {
        accessorKey: 'signedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Signed" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(row.original.signedAt), { addSuffix: true })}
          </span>
        ),
      },
    ],
    []
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <FileText className="h-7 w-7" />
          All Consents
        </h1>
        <p className="text-muted-foreground mt-1">Tracker of all signed patient consent forms.</p>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Consent Records</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={rows} />
        </CardContent>
      </Card>
    </div>
  )
}
