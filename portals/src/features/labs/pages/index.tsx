import { AlertTriangle, Building2, FileText, Layers } from 'lucide-react'
import { api } from '@/lib/api-client'
import { useCan, usePermissions } from '@/lib/permissions-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { LabBaseServicesTab } from '../components/lab-base-services-tab'
import { LabCasesTab } from '../components/lab-cases-tab'
import { LabVendorsTab } from '../components/lab-vendors-tab'
import type { LabVendor } from '../types'

export default function LabsPage() {
  const isReadOnly = !useCan('labs', 'update')

  const permissions = usePermissions()
  const showVendors = permissions?.isAdmin ?? false

  // Shared across the Cases (vendor picker) and Vendors tabs — a save/delete
  // in Vendors invalidates this key so the picker in Cases stays in sync too.
  const vendorsQuery = useApiQuery(queryKeys.labs.vendors(), () =>
    api.get<LabVendor[]>('/api/labs/vendors')
  )
  const vendors = vendorsQuery.data ?? []

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border">
        <h1 className="text-2xl font-bold">Labs</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Lab cases, the base service catalogue, and the vendors who fulfil them. Clinic-facing lab
          prices live in the Services module and point back at a base service here.
        </p>
      </div>

      {isReadOnly && (
        <div className="px-6 pt-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <h5 className="font-bold text-sm text-amber-900 leading-none">Read-Only Mode</h5>
              <p className="text-xs text-amber-800 mt-1.5 leading-relaxed">
                You are viewing the Labs workspace with read-only permissions. Doctors can inspect
                case details, status history, and notes, but cannot submit updates or perform
                deletions.
              </p>
            </div>
          </div>
        </div>
      )}

      <Tabs defaultValue="cases" className="flex-1 flex flex-col min-h-0">
        <div className="px-6 pt-4 border-b border-border">
          <TabsList>
            <TabsTrigger value="cases">
              <FileText className="mr-2 h-3.5 w-3.5" />
              Cases
            </TabsTrigger>
            {showVendors && (
              <TabsTrigger value="base-services">
                <Layers className="mr-2 h-3.5 w-3.5" />
                Base Services
              </TabsTrigger>
            )}
            {showVendors && (
              <TabsTrigger value="vendors">
                <Building2 className="mr-2 h-3.5 w-3.5" />
                Vendors
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="cases" className="flex-1 min-h-0 m-0 p-6 overflow-y-auto">
          <LabCasesTab vendors={vendors} />
        </TabsContent>

        {showVendors && (
          <TabsContent value="base-services" className="flex-1 min-h-0 m-0 p-6 overflow-y-auto">
            <LabBaseServicesTab isAdmin={permissions?.isAdmin ?? false} />
          </TabsContent>
        )}

        {showVendors && (
          <TabsContent value="vendors" className="flex-1 min-h-0 m-0 p-6 overflow-y-auto">
            <LabVendorsTab vendors={vendors} onChanged={() => vendorsQuery.refetch()} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
