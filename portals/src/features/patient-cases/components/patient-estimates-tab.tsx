import { format } from 'date-fns'
import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CreateEstimateSheet } from '@/features/activity/components/create-estimate-sheet'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { formatCurrency } from '@/shared/utils/currency'

interface Props {
  patientId: string
  canEdit?: boolean
}

/** One row of `GET /api/estimates/patient/:id` — the clinical list, no payment figures. */
type EstimateRow = {
  id: string
  invoiceNumber: string
  description: string | null
  status: string
  total: number | null
  createdAt: string | null
}

export function PatientEstimatesTab({ patientId, canEdit = false }: Props) {
  const { hasPermission } = usePermissions()
  // The estimate permissions, not clinical:manage / patients:manage, which have
  // nothing to do with estimates and left a doctor with neither button.
  const canCreate = hasPermission('estimates', 'create')
  const canSend = canEdit && hasPermission('estimates', 'update')

  const [estimates, setEstimates] = useState<EstimateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [patientName, setPatientName] = useState<string>('Patient')

  // Sending-to-reception state
  const [sendingId, setSendingId] = useState<string | null>(null)

  const loadEstimates = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // The name only labels the builder; failing to fetch it is not worth an error.
      const pRes = await api.get<{ name?: string }>(`/api/patients/${patientId}`)
      if (pRes.success && pRes.data?.name) setPatientName(pRes.data.name)

      const res = await api.get<EstimateRow[]>(`/api/estimates/patient/${patientId}`)
      if (res.success && Array.isArray(res.data)) {
        setEstimates(res.data)
      } else {
        // A refused or failed list is not "no estimates": say so, don't show an empty tab.
        setEstimates([])
        setLoadError(res.error || 'Please try again.')
      }
    } catch (err) {
      setEstimates([])
      setLoadError(err instanceof Error && err.message ? err.message : 'Please try again.')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    loadEstimates()
  }, [loadEstimates])

  const handleSendToReception = async (invoiceId: string) => {
    setSendingId(invoiceId)
    const res = await api.post(`/api/invoices/${invoiceId}/send-to-reception`, {})
    setSendingId(null)

    if (res.success) {
      toast.success('Sent to reception. They can confirm it from the Activity page.')
      loadEstimates()
    } else {
      toast.error(res.error || 'Failed to send to reception.')
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Estimates & Plans</h3>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Create Estimate / Plan
          </Button>
        )}
      </div>

      {loading ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/40 p-8 text-center"
        >
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-sm font-medium">Could not load estimates.</p>
          <p className="text-xs text-muted-foreground">{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => loadEstimates()}>
            Retry
          </Button>
        </div>
      ) : estimates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>No pending estimates or plans found.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Invoice #</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Description
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Amount</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((est) => (
                <tr key={est.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    {est.createdAt ? format(new Date(est.createdAt), 'MMM d, yyyy') : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{est.invoiceNumber}</td>
                  <td className="px-4 py-3">{est.description || 'Estimate'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'capitalize text-xs font-medium px-2 py-0.5 rounded-full border',
                        est.status === 'draft' &&
                          'bg-slate-100 text-foreground border-border dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
                        est.status === 'pending' &&
                          'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
                        est.status === 'paid' &&
                          'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800',
                        (est.status === 'void' ||
                          est.status === 'voided' ||
                          est.status === 'cancelled') &&
                          'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800',
                        (est.status === 'sent' || est.status === 'issued') &&
                          'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800'
                      )}
                    >
                      {est.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {formatCurrency(est.total ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {est.status === 'draft' && canSend && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSendToReception(est.id)}
                        disabled={sendingId === est.id}
                      >
                        {sendingId === est.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          'Send to reception'
                        )}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateEstimateSheet
          patientId={patientId}
          patientName={patientName}
          open={showCreate}
          onOpenChange={setShowCreate}
          onCreated={loadEstimates}
        />
      )}
    </div>
  )
}
