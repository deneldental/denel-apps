import { useQueryClient } from '@tanstack/react-query'
import { Mail, MapPin, Pencil, Phone, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import type { InsuranceCompany } from '../types'
import { CompanyFormSheet } from './company-form-sheet'
import { InsurancePricingSection } from './insurance-pricing-section'
import { InsurerPriceGrid } from './insurer-price-grid'

interface Props {
  companyId: string
  onChanged: () => void
  onDeleted: () => void
}

/**
 * Right-hand panel showing one company's contact info + its pricing.
 * Pricing has two entry points onto the same tables: `<InsurerPriceGrid>` for
 * per-service edits and `<InsurancePricingSection>` for bulk CSV price lists.
 * The old opaque-PDF upload has been removed.
 */
export function CompanyDetailPanel({ companyId, onChanged, onDeleted }: Props) {
  const queryClient = useQueryClient()
  const [company, setCompany] = useState<InsuranceCompany | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteCompanyOpen, setDeleteCompanyOpen] = useState(false)
  // Incremented whenever the CSV section changes what's effective, so the grid
  // above it refetches instead of showing a stale price set.
  const [pricingVersion, setPricingVersion] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<InsuranceCompany>(`/api/insurance/companies/${companyId}`)
    if (res.success && res.data) setCompany(res.data)
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    load()
  }, [load])

  async function confirmDeleteCompany() {
    if (!company) return
    const res = await api.delete(`/api/insurance/companies/${company.id}`)
    if (res.success) {
      toast.success('Company deleted')
      // Keep the shared `useInsuranceCompanies()` cache (30 min) honest.
      void queryClient.invalidateQueries({ queryKey: queryKeys.insurance.all })
      setDeleteCompanyOpen(false)
      onDeleted()
    } else {
      toast.error((res.error as string) || 'Failed to delete')
      throw new Error('delete failed')
    }
  }

  if (loading || !company) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{company.name}</h2>
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            {company.contactEmail && (
              <div className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> {company.contactEmail}
              </div>
            )}
            {company.contactPhone && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> {company.contactPhone}
              </div>
            )}
            {company.address && (
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> {company.address}
              </div>
            )}
          </div>
          {company.notes && <p className="mt-2 text-sm text-muted-foreground">{company.notes}</p>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={() => setDeleteCompanyOpen(true)}
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Two ways into the same price-list tables: the grid for single edits,
          CSV for bulk. A CSV upload replaces what the grid shows, so the grid
          re-reads whenever the pricing section reports a change. */}
      <InsurerPriceGrid companyId={companyId} refreshToken={pricingVersion} />
      <InsurancePricingSection
        companyId={companyId}
        onPricingChanged={() => setPricingVersion((v) => v + 1)}
      />

      <CompanyFormSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        company={company}
        onSaved={() => {
          setEditOpen(false)
          load()
          onChanged()
        }}
      />

      <DeleteConfirmationDialog
        open={deleteCompanyOpen}
        onOpenChange={setDeleteCompanyOpen}
        onConfirm={confirmDeleteCompany}
        title="Delete insurance company?"
        description="This also removes the company's pricing and any pending approvals."
        itemName={company.name}
      />
    </div>
  )
}
