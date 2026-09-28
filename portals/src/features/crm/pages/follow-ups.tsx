import { PhoneCall } from 'lucide-react'
import { getCrmFollowUps } from '@/lib/actions/crm'
import { useBranding } from '@/lib/branding-context'
import { CampaignPageShell } from '../components/campaign-page-shell'
import { useCrmCampaignEntries } from '../hooks/use-crm-campaign-entries'

export default function FollowUpsPage() {
  const branding = useBranding()
  const { entries, loading } = useCrmCampaignEntries('follow-ups', getCrmFollowUps)

  return (
    <CampaignPageShell
      title="Follow-ups"
      subtitle="Patients treated 48–72 hours ago who deserve a check-in SMS."
      icon={PhoneCall}
      contextColumnLabel="Last visit"
      entries={entries}
      loading={loading}
      buildMessage={(entry) =>
        `Hello ${entry.patientName}, this is ${branding.name}. We hope you're recovering well after your recent visit. Please reply if you have any concerns.`
      }
      buildBulkMessage={() =>
        `Hello, this is ${branding.name}. We hope you're recovering well after your recent visit. Please reply if you have any concerns.`
      }
    />
  )
}
