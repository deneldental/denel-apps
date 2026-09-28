import { FileText, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { CompaniesList } from '../components/companies-list'
import { CompanyDetailPanel } from '../components/company-detail-panel'
import { CompanyFormSheet } from '../components/company-form-sheet'
import type { InsuranceCompany } from '../types'

/**
 * Companies & Pricing page (M6).
 *
 * Extracted from the previous tabs-based InsurancePage. Owns the "left rail
 * of companies + right detail panel" surface. The mini-sidebar handles the
 * outer Summary / Claims / Reconciliation switching.
 */
export default function InsuranceCompaniesPage() {
  const [companies, setCompanies] = useState<InsuranceCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<InsuranceCompany[]>('/api/insurance/companies')
    if (res.success && res.data) {
      setCompanies(res.data)
      // Auto-select the first company so the detail panel isn't empty on load.
      if (!selectedCompanyId && res.data.length > 0) {
        setSelectedCompanyId(res.data[0].id)
      }
    }
    setLoading(false)
  }, [selectedCompanyId])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Companies & Pricing</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Manage insurance partners and their CSV price lists.
            </p>
          </div>
        </div>
      </div>

      <div className="flex h-full min-h-0 flex-1">
        {/* Left: companies list */}
        <div className="w-72 shrink-0 overflow-y-auto border-r border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Companies
            </p>
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <CompaniesList
              companies={companies}
              selectedId={selectedCompanyId}
              onSelect={setSelectedCompanyId}
            />
          )}
        </div>

        {/* Right: selected company detail */}
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {selectedCompanyId ? (
            <CompanyDetailPanel
              companyId={selectedCompanyId}
              onChanged={load}
              onDeleted={() => {
                setSelectedCompanyId(null)
                load()
              }}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Select or create a company to view pricing.
              </p>
            </div>
          )}
        </div>
      </div>

      <CompanyFormSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        company={null}
        onSaved={() => {
          setCreateOpen(false)
          load()
        }}
      />
    </div>
  )
}
