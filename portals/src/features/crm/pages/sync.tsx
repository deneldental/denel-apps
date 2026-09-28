import { GoogleContactsSyncTab } from '@/features/messaging/components/google-contacts-sync-tab'

export default function CrmSyncPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Google Contacts Sync</h1>
        <p className="text-muted-foreground">
          Sync patients to Google Contacts and manage sync status.
        </p>
      </div>
      <GoogleContactsSyncTab />
    </div>
  )
}
