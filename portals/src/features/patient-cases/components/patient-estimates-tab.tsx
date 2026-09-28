import { format } from 'date-fns'
import { Loader2, Plus } from 'lucide-react'
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

export function PatientEstimatesTab({ patientId, canEdit = false }: Props) {
  const { isAdmin, hasPermission } = usePermissions()
  const canManage =
    isAdmin || hasPermission('clinical', 'manage') || hasPermission('patients', 'manage')
  const [estimates, setEstimates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [patientName, setPatientName] = useState<string>('Patient')

  // Generating Invoice state
  const [generatingId, setGeneratingId] = useState<string | null>(null)

  const loadEstimates = useCallback(async () => {
    setLoading(true)

    // Fetch patient name
    const pRes = await api.get<{ success: boolean; data: any }>(`/api/patients/${patientId}`)
    if (pRes.success && pRes.data && (pRes.data as any).name) {
      setPatientName((pRes.data as any).name)
    }

    const res = await api.get<{ success: boolean; data: any[] }>(
      `/api/invoices/patient/${patientId}`
    )
    if (res.success && res.data) {
      // Filter for one-time invoices (estimates), regardless of status
      setEstimates((res.data as unknown as any[]).filter((inv: any) => inv.type === 'one_time'))
    }
    setLoading(false)
  }, [patientId])

  useEffect(() => {
    loadEstimates()
  }, [loadEstimates])

  const handleGenerateInvoice = async (invoiceId: string) => {
    setGeneratingId(invoiceId)
    // We will call a new endpoint to push this estimate to the receptionist activity page
    const res = await api.post(`/api/invoices/${invoiceId}/send-to-reception`, {})
    setGeneratingId(null)

    if (res.success) {
      toast.success('Invoice generated and sent to reception activity page.')
      loadEstimates()
    } else {
      toast.error(res.error || 'Failed to generate invoice.')
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Estimates & Plans</h3>
        {canManage && (
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
                        (est.status === 'voided' || est.status === 'cancelled') &&
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
                    {est.status === 'draft' && canManage && canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGenerateInvoice(est.id)}
                        disabled={generatingId === est.id}
                      >
                        {generatingId === est.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          'Generate Invoice'
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
