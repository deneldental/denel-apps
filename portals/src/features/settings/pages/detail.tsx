import { ChevronRight } from 'lucide-react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import AppPaymentMethodsPage from '@/features/app-payments/pages/payment-methods'
import HolidaysPage from '@/features/crm/pages/holidays'
import SmsTemplatesPage from '@/features/crm/pages/sms-templates'
import DataInjectPage from '@/features/data-inject/pages/index'
import { BrandingConfigCard } from '@/features/integrations/components/branding-config-card'
import IntegrationsHubPage from '@/features/integrations/pages/index'
import LedgerAdjustmentsPage from '@/features/ledger-adjustments/pages/index'
import { AlertsSection } from '@/features/settings/components/alerts-section'
import { AppointmentRemindersSection } from '@/features/settings/components/appointment-reminders-section'
import { AppointmentTypesSection } from '@/features/settings/components/appointment-types-section'
import { CategoriesSection } from '@/features/settings/components/categories-section'
import { ClinicalLookupSection } from '@/features/settings/components/clinical-lookup-section'
import { ClinicalPreferencesSection } from '@/features/settings/components/clinical-preferences-section'
import { ComplianceCategoriesSection } from '@/features/settings/components/compliance-categories-section'
import { ConsentTemplatesSection } from '@/features/settings/components/consent-templates-section'
import { CrmAutomationsSection } from '@/features/settings/components/crm-automations-section'
import { DataManagementSection } from '@/features/settings/components/data-management-section'
import { DatabaseManagementSection } from '@/features/settings/components/database-management-section'
import { DocumentTagsSection } from '@/features/settings/components/document-tags-section'
import { ExaminationTypesSection } from '@/features/settings/components/examination-types-section'
import { ExpenseCategoriesSection } from '@/features/settings/components/expense-categories-section'
import { InventoryLocationsSection } from '@/features/settings/components/inventory-locations-section'
import { InventoryPoliciesSection } from '@/features/settings/components/inventory-policies-section'
import { LabWorkflowSection } from '@/features/settings/components/lab-workflow-section'
import { LowStockAlertSection } from '@/features/settings/components/low-stock-alert-section'
import { ModuleVisibilitySection } from '@/features/settings/components/module-visibility-section'
import { MonthlyThresholdSettingsSection } from '@/features/settings/components/monthly-threshold-settings-section'
import { OperatingHoursSection } from '@/features/settings/components/operating-hours-section'
import { PatientTagsSection } from '@/features/settings/components/patient-tags-section'
import { PaymentMethodsSection } from '@/features/settings/components/payment-methods-section'
import { PettyCashPolicySection } from '@/features/settings/components/petty-cash-policy-section'
import { SecurityKioskSection } from '@/features/settings/components/security-kiosk-section'
import { UnitsSection } from '@/features/settings/components/units-section'
import { XrayTypesSection } from '@/features/settings/components/xray-types-section'
import {
  SECTION_TITLES,
  SETTINGS_GROUPS,
  sectionsVisibleTo,
  tabLabelFor,
} from '@/features/settings/settings-groups'
import TaxConfigurationPage from '@/features/tax-config/pages/index'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/shared/hooks/use-permissions'

const CLINICAL_LOOKUP_CONFIG: Record<
  string,
  { type: string; title: string; description: string; noun: string }
> = {
  'presenting-complaints': {
    type: 'presenting-complaints',
    title: 'Presenting Complaints',
    description: 'Options shown in the Presenting Complaint and Diagnosis stages.',
    noun: 'Complaint',
  },
  'past-medical-history': {
    type: 'past-medical-history',
    title: 'Past Medical History',
    description: 'Conditions and surgical history shown in the medical history stage.',
    noun: 'History item',
  },
  'drug-history-items': {
    type: 'drug-history-items',
    title: 'Drug History Items',
    description: 'Prescriptions listed in the drug history stage.',
    noun: 'Drug',
  },
  allergies: {
    type: 'allergies',
    title: 'Allergies',
    description: 'Allergies offered in the drug history & allergies stage.',
    noun: 'Allergy',
  },
  'social-history-items': {
    type: 'social-history-items',
    title: 'Social History Items',
    description: 'Smoking, alcohol, occupation factors offered in the social history stage.',
    noun: 'Item',
  },
  'dental-review-items': {
    type: 'dental-review-items',
    title: 'Dental Review Items',
    description: 'Feedback options offered in the dental review stage.',
    noun: 'Review item',
  },
  'ortho-treatments': {
    type: 'ortho-treatments',
    title: 'Ortho Treatments',
    description: 'Treatments offered in the orthodontic review stage (current / next).',
    noun: 'Treatment',
  },
  specialties: {
    type: 'specialties',
    title: 'Specialties',
    description:
      'The clinical specialisation a doctor is created with (Orthodontics, Oral Surgery, …). Inactive entries stay on existing doctors but drop out of the picker on the Add specialist form.',
    noun: 'Specialisation',
  },
  'drug-frequencies': {
    type: 'drug-frequencies',
    title: 'Drug Frequencies',
    description: 'Frequency presets used when prescribing Prescription.',
    noun: 'Frequency',
  },
}

export default function SettingsDetailPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isAdmin, isLoading } = usePermissions()

  const group = SETTINGS_GROUPS.find((g) => g.id === groupId)

  if (!group) {
    return <Navigate to="/settings" replace />
  }

  if (group.adminOnly && !isAdmin && !isLoading) {
    return <Navigate to="/settings" replace />
  }

  // Only tabs this user can render are offered, and an unknown or
  // not-allowed `?section=` lands on the group's first visible tab instead
  // of a blank page (settings-domain-audit D8).
  const visibleSections = sectionsVisibleTo(group, isAdmin)
  const requested = searchParams.get('section')
  const section =
    requested && visibleSections.includes(requested)
      ? requested
      : (visibleSections[0] ?? group.sections[0])

  function renderSection(sectionId: string) {
    if (isLoading) {
      return null
    }
    switch (sectionId) {
      case 'clinic-profile':
        // "Clinic Info" tab — name / contact / social + operating hours, stacked.
        return (
          <div className="space-y-6">
            <BrandingConfigCard mode="info" />
            <OperatingHoursSection />
          </div>
        )
      case 'brand-assets':
        // "Brand Assets" tab — logos + login/background images, no colour.
        return <BrandingConfigCard mode="assets" />
      case 'module-visibility':
        return isAdmin ? <ModuleVisibilitySection /> : null
      case 'data-management':
        return isAdmin ? <DataManagementSection /> : null
      case 'database':
        return isAdmin ? <DatabaseManagementSection /> : null
      case 'data-inject-hub':
        return isAdmin ? <DataInjectPage /> : null
      case 'operating-hours':
        return <OperatingHoursSection />
      case 'tax-config':
        return isAdmin ? <TaxConfigurationPage /> : null
      case 'petty-cash-policy':
        return isAdmin ? <PettyCashPolicySection /> : null
      case 'payment-methods':
        return isAdmin ? <PaymentMethodsSection /> : null
      case 'app-payment-methods':
        return isAdmin ? <AppPaymentMethodsPage /> : null
      case 'expense-categories':
        return isAdmin ? <ExpenseCategoriesSection /> : null
      case 'appointment-types':
        return isAdmin ? <AppointmentTypesSection /> : null
      case 'appointment-reminders':
        return isAdmin ? <AppointmentRemindersSection /> : null
      case 'charting-preferences':
        return isAdmin ? <ClinicalPreferencesSection /> : null
      case 'crm-automations':
      case 'crm-cooldown':
        return isAdmin ? <CrmAutomationsSection /> : null
      case 'sms-templates':
        return isAdmin ? <SmsTemplatesPage /> : null
      case 'crm-holidays':
        return isAdmin ? <HolidaysPage /> : null
      case 'inventory-policies':
        return isAdmin ? <InventoryPoliciesSection /> : null
      case 'security-kiosk':
        return isAdmin ? <SecurityKioskSection /> : null
      case 'consent-templates':
        return isAdmin ? <ConsentTemplatesSection /> : null
      case 'integrations-hub':
        return isAdmin ? <IntegrationsHubPage /> : null
      case 'examination-types':
        return isAdmin ? <ExaminationTypesSection /> : null
      case 'units':
        return isAdmin ? <UnitsSection /> : null
      case 'categories':
        return isAdmin ? <CategoriesSection /> : null
      case 'low-stock-alert':
        return isAdmin ? <LowStockAlertSection /> : null
      case 'alerts':
        return isAdmin ? <AlertsSection /> : null
      case 'monthly-threshold':
        return isAdmin ? <MonthlyThresholdSettingsSection /> : null
      case 'patient-tags':
        return isAdmin ? <PatientTagsSection /> : null
      case 'document-tags':
        return isAdmin ? <DocumentTagsSection /> : null
      case 'compliance-categories':
        return isAdmin ? <ComplianceCategoriesSection /> : null
      case 'compliance-tags':
        return isAdmin ? (
          <ClinicalLookupSection
            type="compliance-tags"
            title="Compliance Tags"
            description="Tags used to categorize compliance documents and audits."
            noun="Tag"
          />
        ) : null
      case 'inventory-locations':
        return isAdmin ? <InventoryLocationsSection /> : null
      case 'xray-types':
        return isAdmin ? <XrayTypesSection /> : null
      case 'lab-workflow':
        return isAdmin ? <LabWorkflowSection /> : null
      case 'ledger-adjustments':
        return isAdmin ? <LedgerAdjustmentsPage /> : null
      case 'presenting-complaints':
      case 'past-medical-history':
      case 'drug-history-items':
      case 'allergies':
      case 'social-history-items':
      case 'dental-review-items':
      case 'ortho-treatments':
      case 'specialties':
      case 'drug-frequencies': {
        const cfg = CLINICAL_LOOKUP_CONFIG[sectionId]
        return isAdmin ? (
          <ClinicalLookupSection
            type={cfg.type}
            title={cfg.title}
            description={cfg.description}
            noun={cfg.noun}
          />
        ) : null
      }
      default:
        // Unreachable: `section` is validated against the visible tabs above.
        return null
    }
  }

  function changeSection(next: string) {
    const params = new URLSearchParams(searchParams)
    params.set('section', next)
    setSearchParams(params, { replace: true })
  }

  const isMultiTab = visibleSections.length > 1
  const title = isMultiTab ? group.label : (SECTION_TITLES[section] ?? 'Settings')

  return (
    <div className="flex h-full flex-col">
      <main className="min-w-0 flex-1 overflow-y-auto bg-muted/30">
        <div className="p-6">
          <div className="mb-4 flex items-center text-sm text-muted-foreground">
            <Link to="/settings" className="hover:text-foreground">
              All Settings
            </Link>
            <ChevronRight className="mx-2 h-4 w-4" />
            <span className="font-medium text-foreground">{group.label}</span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage {title.toLowerCase()}.</p>

          {isMultiTab && (
            <div className="mt-5 -mx-1 flex flex-wrap items-center gap-1 border-b border-border">
              {visibleSections.map((sId) => {
                const isActive = sId === section
                return (
                  <button
                    key={sId}
                    type="button"
                    onClick={() => changeSection(sId)}
                    className={cn(
                      'rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {tabLabelFor(sId)}
                  </button>
                )
              })}
            </div>
          )}

          <div className="mt-6">{renderSection(section)}</div>
        </div>
      </main>
    </div>
  )
}
