import { BulkSMSTab } from '@/features/messaging/components/bulk-sms-tab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'

export default function MessagingPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">SMS</h1>
        <p className="text-muted-foreground">Send SMS messages to patients.</p>
      </div>

      <Tabs defaultValue="bulk-sms" className="w-full">
        <TabsList>
          <TabsTrigger value="bulk-sms">Bulk SMS</TabsTrigger>
        </TabsList>
        <TabsContent value="bulk-sms" className="mt-4">
          <BulkSMSTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
