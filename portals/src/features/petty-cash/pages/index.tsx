import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { PettyProvidersTab } from '../components/petty-providers-tab'
import { PettySettingsTab } from '../components/petty-settings-tab'
import { PettyStaffTab } from '../components/petty-staff-tab'
import { PettyTransactionsTab } from '../components/petty-transactions-tab'

const TABS = [
  { value: 'transactions', label: 'Transactions' },
  { value: 'providers', label: 'Service Providers' },
  { value: 'staff', label: 'Staff' },
  { value: 'settings', label: 'Settings' },
]

export default function PettyCashPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'transactions'

  function setTab(tab: string) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', tab)
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-0 border-b border-border">
        <h1 className="text-2xl font-bold tracking-tight">Petty Cash</h1>
        <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
          Small cash expenses, tagged by category, with a manager review trail.
        </p>
        <Tabs value={activeTab} onValueChange={setTab}>
          <TabsList className="h-auto gap-0 rounded-none border-b-0 bg-transparent p-0">
            {TABS.map((t) => (
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
          <TabsContent value="transactions" className="mt-0">
            <PettyTransactionsTab />
          </TabsContent>
          <TabsContent value="providers" className="mt-0">
            <PettyProvidersTab />
          </TabsContent>
          <TabsContent value="staff" className="mt-0">
            <PettyStaffTab />
          </TabsContent>
          <TabsContent value="settings" className="mt-0">
            <PettySettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
