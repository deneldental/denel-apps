import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { ReconciliationTab } from '../components/reconciliation-tab'
import type { InsuranceCompany } from '../types'

/**
 * Reconciliation page (M6).
 *
 * Thin shell around the existing `<ReconciliationTab>` component. We still
 * fetch the company list here because the reconciliation table needs it for
 * the company filter + the "new entry" sheet picker; centralizing the load
 * here means the component itself stays focused on rendering.
 */
export default function InsuranceReconciliationPage() {
  const [companies, setCompanies] = useState<InsuranceCompany[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await api.get<InsuranceCompany[]>('/api/insurance/companies')
      if (!cancelled && res.success && res.data) setCompanies(res.data)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-2xl font-bold">Reconciliation</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Track insurance-funded treatments against insurer settlements.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <ReconciliationTab companies={companies} />
      </div>
    </div>
  )
}
