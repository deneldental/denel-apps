import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { usePermissions } from '@/shared/hooks/use-permissions'
import InsuranceApprovalsPage from './approvals'
import InsuranceClaimsPage from './claims'
import InsuranceCompaniesPage from './companies'
import InsuranceReconciliationPage from './reconciliation'
import InsuranceSummaryPage from './summary'

const TABS = [
  { value: 'summary', label: 'Summary' },
  { value: 'companies', label: 'Companies' },
  { value: 'approvals', label: 'Approvals' },
  { value: 'claims', label: 'Claims' },
  { value: 'reconciliation', label: 'Reconciliation' },
]

export default function InsurancePage() {
  const { roleId, roleName } = usePermissions()
  const isReceptionist =
    roleId === 'receptionist' ||
    roleName?.toLowerCase() === 'receptionist' ||
    roleName?.toLowerCase().includes('reception')

  const tabs = isReceptionist ? TABS.filter((t) => t.value === 'claims') : TABS

  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || (isReceptionist ? 'claims' : 'summary')

  function setTab(tab: string) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', tab)
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-0 border-b border-border">
        <h1 className="text-2xl font-bold tracking-tight mb-4">Insurance</h1>
        <Tabs value={activeTab} onValueChange={setTab}>
          <TabsList className="h-auto rounded-none border-b-0 bg-transparent p-0 gap-0">
            {tabs.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm font-medium data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 overflow-auto">
        <Tabs value={activeTab} onValueChange={setTab}>
          <TabsContent value="summary" className="mt-0 h-full">
            <InsuranceSummaryPage />
          </TabsContent>
          <TabsContent value="companies" className="mt-0 h-full">
            <InsuranceCompaniesPage />
          </TabsContent>
          <TabsContent value="approvals" className="mt-0 h-full">
            <InsuranceApprovalsPage />
          </TabsContent>
          <TabsContent value="claims" className="mt-0 h-full">
            <InsuranceClaimsPage />
          </TabsContent>
          <TabsContent value="reconciliation" className="mt-0 h-full">
            <InsuranceReconciliationPage />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
