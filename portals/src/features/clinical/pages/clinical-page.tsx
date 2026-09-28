import { FolderOpen, Pill, Stethoscope } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { ClinicalCasesTab } from '../components/clinical-cases-tab'
import { ClinicalPrescriptionsTab } from '../components/clinical-prescriptions-tab'
import { ClinicalTreatmentsTab } from '../components/clinical-treatments-tab'

const VALID_TABS = ['cases', 'treatments', 'prescriptions'] as const
type ClinicalTab = (typeof VALID_TABS)[number]

function isValidTab(value: string | undefined): value is ClinicalTab {
  return !!value && (VALID_TABS as readonly string[]).includes(value)
}

export function ClinicalPage() {
  const navigate = useNavigate()
  const { tab } = useParams<{ tab?: string }>()
  const activeTab: ClinicalTab = isValidTab(tab) ? tab : 'cases'

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Clinical</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage patient cases, treatment plans, and prescriptions.
        </p>
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => navigate(`/clinical/${v}`, { replace: true })}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="w-fit">
          <TabsTrigger value="cases" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Cases
          </TabsTrigger>
          <TabsTrigger value="treatments" className="gap-2">
            <Stethoscope className="h-4 w-4" />
            Estimates & Plans
          </TabsTrigger>
          <TabsTrigger value="prescriptions" className="gap-2">
            <Pill className="h-4 w-4" />
            Prescriptions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cases" className="mt-4 flex-1 overflow-auto">
          <ClinicalCasesTab canEdit isAdmin />
        </TabsContent>
        <TabsContent value="treatments" className="mt-4 flex-1 overflow-auto">
          <ClinicalTreatmentsTab />
        </TabsContent>
        <TabsContent value="prescriptions" className="mt-4 flex-1 overflow-auto">
          <ClinicalPrescriptionsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
