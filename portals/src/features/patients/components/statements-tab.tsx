// Statements tab (M2.2) — list of persisted PDF statements for a patient,
// with a "Generate New" action that opens the GenerateStatementDialog.
//
// Data: GET /api/patient-statements/patient/:patientId.
// Download: GET /api/patient-statements/:statementId/download (302 → CDN).

import { format } from 'date-fns'
import { Download, FileText, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { GenerateStatementDialog } from '@/features/patients/components/generate-statement-dialog'
import { api } from '@/lib/api-client'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

interface StatementsTabProps {
  patientId: string
  canGenerate?: boolean
  /** Admins may delete statements (record + stored PDF). */
  isAdmin?: boolean
}

interface StatementRow {
  id: string
  patientId: string
  fromDate: string
  toDate: string
  fileKey: string
  generatedBy: string
  generatedByName: string | null
  generatedAt: string
  sizeBytes: number | null
  createdAt: string
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function StatementsTab({
  patientId,
  canGenerate = true,
  isAdmin = false,
}: StatementsTabProps) {
  const [statements, setStatements] = useState<StatementRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<StatementRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await api.get<StatementRow[]>(`/api/patient-statements/patient/${patientId}`)
    if (!res.success) {
      setError((res.error as string) ?? 'Failed to load statements')
      setStatements(null)
    } else {
      setStatements(res.data ?? [])
    }
    setLoading(false)
  }, [patientId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // Fetch the short-lived presigned URL through the authenticated api-client
  // (sends X-App-Id), then open it. A plain <a href> to the backend endpoint
  // can't carry X-App-Id and 401s ("Not authenticated") — see the /download
  // route's ?format=json branch.
  async function handleDownload(id: string) {
    setDownloadingId(id)
    try {
      const res = await api.get<{ url: string }>(
        `/api/patient-statements/${id}/download?format=json`
      )
      if (!res.success || !res.data?.url) {
        toast.error(res.error ?? 'Failed to open statement')
        return
      }
      window.open(res.data.url, '_blank', 'noopener')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Statements</h3>
          <p className="text-xs text-muted-foreground">Previously generated patient statements.</p>
        </div>
        {canGenerate && (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Generate New
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="mb-2">{error}</div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void load()
            }}
          >
            Retry
          </Button>
        </div>
      ) : !statements || statements.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="font-medium text-muted-foreground">No statements yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Generate one to get started.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Generated</TableHead>
                <TableHead>Date Range</TableHead>
                <TableHead>Generated By</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statements.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {format(new Date(s.generatedAt), 'MMM d, yyyy h:mm a')}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {format(new Date(s.fromDate), 'MMM d, yyyy')} —{' '}
                    {format(new Date(s.toDate), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="text-sm">{s.generatedByName ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatSize(s.sizeBytes)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleDownload(s.id)}
                        disabled={downloadingId === s.id}
                        aria-label="Download statement PDF"
                      >
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        {downloadingId === s.id ? 'Opening…' : 'Download'}
                      </Button>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(s)}
                          aria-label="Delete statement"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <GenerateStatementDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patientId={patientId}
        onGenerated={() => {
          void load()
        }}
      />

      <DeleteConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
        title="Delete statement"
        description="This permanently removes the statement record and its PDF. This cannot be undone."
        itemName={
          deleteTarget
            ? `Statement ${format(new Date(deleteTarget.fromDate), 'MMM d, yyyy')} — ${format(
                new Date(deleteTarget.toDate),
                'MMM d, yyyy'
              )}`
            : undefined
        }
        onConfirm={async () => {
          if (!deleteTarget) return
          const res = await api.delete(`/api/patient-statements/${deleteTarget.id}`)
          if (!res.success) {
            toast.error(res.error ?? 'Failed to delete statement')
            return
          }
          toast.success('Statement deleted')
          setDeleteTarget(null)
          void load()
        }}
      />
    </div>
  )
}
