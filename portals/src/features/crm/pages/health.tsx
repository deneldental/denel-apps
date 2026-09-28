import { EmailStatusTab } from '@/features/messaging/components/email-status-tab'
import { FailedSMSTab } from '@/features/messaging/components/failed-sms-tab'
import { SMSStatusTab } from '@/features/messaging/components/sms-status-tab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { EmailComposerTab } from '../components/email-composer-tab'

export default function CrmHealthPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comms Health</h1>
        <p className="text-muted-foreground">Monitor SMS and email delivery status.</p>
      </div>

      <Tabs defaultValue="sms-status" className="w-full">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="sms-status">SMS Status</TabsTrigger>
          <TabsTrigger value="failed-sms">Failed SMS</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="email-status">Email Status</TabsTrigger>
        </TabsList>
        <TabsContent value="sms-status" className="mt-4">
          <SMSStatusTab />
        </TabsContent>
        <TabsContent value="failed-sms" className="mt-4">
          <FailedSMSTab />
        </TabsContent>
        <TabsContent value="email" className="mt-4">
          <EmailComposerTab />
        </TabsContent>
        <TabsContent value="email-status" className="mt-4">
          <EmailStatusTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
