import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import MemosPage from '@/pages/MemosPage'
import RequestsListPage from '@/pages/requests/RequestsListPage'
import PayslipsPage from '@/pages/staff/PayslipsPage'

const TAB_VALUES = ['memos', 'requests', 'payslips'] as const
type TabValue = (typeof TAB_VALUES)[number]

function isTabValue(value: string | null): value is TabValue {
  return value !== null && (TAB_VALUES as readonly string[]).includes(value)
}

export default function InfoHubPage() {
  const [params, setParams] = useSearchParams()

  const active = useMemo<TabValue>(() => {
    const fromQuery = params.get('tab')
    return isTabValue(fromQuery) ? fromQuery : 'memos'
  }, [params])

  const handleChange = (value: string) => {
    setParams({ tab: value }, { replace: true })
  }

  return (
    <div className="page-enter">
      <div className="px-5 pt-5">
        <h1 className="text-xl font-bold tracking-tight">Info Hub</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Memos, requests, and payslips in one place.
        </p>
      </div>

      <Tabs value={active} onValueChange={handleChange} className="mt-4">
        <div className="px-5">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="memos">Memos</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="payslips">Payslips</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="memos" className="mt-0">
          <MemosPage />
        </TabsContent>
        <TabsContent value="requests" className="mt-0">
          <RequestsListPage />
        </TabsContent>
        <TabsContent value="payslips" className="mt-0">
          <PayslipsPage />
        </TabsContent>
      </Tabs>
    </div>
  )
}
