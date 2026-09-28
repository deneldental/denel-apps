import { RotateCcw } from 'lucide-react'
import { getCrmRecareDue } from '@/lib/actions/crm'
import { useBranding } from '@/lib/branding-context'
import { CampaignPageShell } from '../components/campaign-page-shell'
import { useCrmCampaignEntries } from '../hooks/use-crm-campaign-entries'

export default function RecallsPage() {
  const branding = useBranding()
  const { entries, loading } = useCrmCampaignEntries('recare-due', getCrmRecareDue)

  return (
    <CampaignPageShell
      title="Recare"
      subtitle="Patients overdue for a 6-month routine checkup."
      icon={RotateCcw}
      contextColumnLabel="Last checkup"
      entries={entries}
      loading={loading}
      buildMessage={(entry) =>
        `Hi ${entry.patientName}, it's been a while since your last checkup at ${branding.name}. Reply BOOK or call us to schedule your routine cleaning.`
      }
      buildBulkMessage={() =>
        `Hi! It's been over six months since your last checkup at ${branding.name}. Reply BOOK or call us to schedule your routine cleaning.`
      }
    />
  )
}
