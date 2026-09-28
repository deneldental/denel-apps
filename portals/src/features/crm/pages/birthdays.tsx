import { Cake } from 'lucide-react'
import { getCrmBirthdays } from '@/lib/actions/crm'
import { useBranding } from '@/lib/branding-context'
import { CampaignPageShell } from '../components/campaign-page-shell'
import { useCrmCampaignEntries } from '../hooks/use-crm-campaign-entries'

export default function BirthdaysPage() {
  const branding = useBranding()
  const { entries, loading } = useCrmCampaignEntries('birthdays', getCrmBirthdays)

  return (
    <CampaignPageShell
      title="Birthdays"
      subtitle="Patients celebrating a birthday this week — send a warm greeting."
      icon={Cake}
      contextColumnLabel="Birthday"
      entries={entries}
      loading={loading}
      buildMessage={(entry) =>
        `Happy birthday, ${entry.patientName}! Wishing you a year of smiles from all of us at ${branding.name}.`
      }
      buildBulkMessage={() =>
        `Happy birthday from all of us at ${branding.name}! Wishing you a year of bright smiles.`
      }
    />
  )
}
