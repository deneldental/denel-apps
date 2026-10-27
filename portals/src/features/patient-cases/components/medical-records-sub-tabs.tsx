import { useSearchParams } from 'react-router-dom'
import { PatientCasesTab } from './patient-cases-tab'
import { PatientEstimatesTab } from './patient-estimates-tab'
import { PatientPrescriptionsTab } from './patient-prescriptions-tab'

const TABS = [
  { value: 'estimates', label: 'Estimates & Plans' },
  { value: 'cases', label: 'Cases' },
  { value: 'prescriptions', label: 'Prescriptions' },
] as const

type TabValue = (typeof TABS)[number]['value']

interface Props {
  patientId: string
  patientName?: string
  canEdit?: boolean
}

export function MedicalRecordsSubTabs({ patientId, patientName, canEdit = false }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('medTab') ?? 'estimates'
  const activeTab: TabValue = (TABS.some((t) => t.value === raw) ? raw : 'estimates') as TabValue

  return (
    <div className="space-y-4">
      <div className="flex border-b">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.value
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.set('medTab', t.value)
              setSearchParams(next, { replace: true })
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'cases' && <PatientCasesTab patientId={patientId} canEdit={canEdit} />}
      {activeTab === 'prescriptions' && (
        <PatientPrescriptionsTab
          patientId={patientId}
          patientName={patientName}
          canEdit={canEdit}
        />
      )}
      {activeTab === 'estimates' && <PatientEstimatesTab patientId={patientId} canEdit={canEdit} />}
    </div>
  )
}
