import { useEffect } from 'react'
import ClinicalAnalyticsPage from '@/features/analytics/pages/clinical'
import ComplianceAnalyticsPage from '@/features/analytics/pages/compliance'
import CrmAnalyticsPage from '@/features/analytics/pages/crm'
import DataIntegrityPage from '@/features/analytics/pages/data-integrity'
import FinancialAnalyticsPage from '@/features/analytics/pages/financial'
import InsuranceAnalyticsPage from '@/features/analytics/pages/insurance'
import OperationalAnalyticsPage from '@/features/analytics/pages/operational'
import ExecutiveOverviewPage from '@/features/analytics/pages/overview'
import PatientAnalyticsPage from '@/features/analytics/pages/patient'
import SpecialistAnalyticsPage from '@/features/analytics/pages/specialist'
import StoreAnalyticsPage from '@/features/analytics/pages/store'
import WorkforceAnalyticsPage from '@/features/analytics/pages/workforce'
import { AnalyticsPeriodProvider, useAnalyticsPeriod } from '@/features/analytics/period-context'

/**
 * Print-only analytics view used by the server-side PDF export. No sidebar,
 * no header controls — just every section stacked for Puppeteer to render
 * into a single PDF. Period comes from the URL via AnalyticsPeriodProvider.
 *
 * Multi-tab pages (Financial, Operational, Workforce) receive `printMode` and
 * render every tab vertically so the export carries the full record.
 */
export default function AnalyticsPrintPage() {
  return (
    <AnalyticsPeriodProvider>
      <PrintBody />
    </AnalyticsPeriodProvider>
  )
}

function PrintBody() {
  const { period } = useAnalyticsPeriod()

  useEffect(() => {
    document.title = `Analytics Report — ${period.label}`
  }, [period.label])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <CoverPage label={period.label} />

      <Section title="1. Executive Overview">
        <ExecutiveOverviewPage />
      </Section>

      <Section title="2. Financial">
        <FinancialAnalyticsPage printMode />
      </Section>

      <Section title="3. Operational">
        <OperationalAnalyticsPage printMode />
      </Section>

      <Section title="4. Patient">
        <PatientAnalyticsPage />
      </Section>

      <Section title="5. Workforce">
        <WorkforceAnalyticsPage printMode />
      </Section>

      <Section title="6. Specialist Commissions">
        <SpecialistAnalyticsPage />
      </Section>

      <Section title="7. Clinical">
        <ClinicalAnalyticsPage />
      </Section>

      <Section title="8. Store / Supply Chain">
        <StoreAnalyticsPage printMode />
      </Section>

      <Section title="9. CRM">
        <CrmAnalyticsPage printMode />
      </Section>

      <Section title="10. Insurance">
        <InsuranceAnalyticsPage printMode />
      </Section>

      <Section title="11. Compliance & Risk">
        <ComplianceAnalyticsPage />
      </Section>

      <Section title="12. Data Integrity">
        <DataIntegrityPage printMode />
      </Section>
    </div>
  )
}

function CoverPage({ label }: { label: string }) {
  return (
    <div
      className="flex h-screen flex-col items-center justify-center border-b text-center"
      style={{ pageBreakAfter: 'always', breakAfter: 'page' }}
    >
      <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
        Denel Dental Clinic
      </p>
      <h1 className="mt-3 text-5xl font-bold tracking-tight">Analytics Report</h1>
      <p className="mt-2 text-2xl text-muted-foreground">{label}</p>
      <p className="mt-12 text-xs text-muted-foreground">
        Generated {new Date().toLocaleString('en-GB')}
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b" style={{ pageBreakBefore: 'always', breakBefore: 'page' }}>
      <div className="border-b border-dashed bg-muted/30 px-6 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </section>
  )
}
