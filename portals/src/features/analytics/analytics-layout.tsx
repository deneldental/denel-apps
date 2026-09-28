import {
  Activity,
  Briefcase,
  Database,
  HeartPulse,
  LayoutDashboard,
  MessageSquare,
  Package,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
  Umbrella,
  Users,
} from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { AnalyticsHeader } from '@/features/analytics/components/analytics-header'
import { AnalyticsPeriodProvider } from '@/features/analytics/period-context'
import { type MiniSidebarItem, MiniSidebarLayout } from '@/shared/components/mini-sidebar-layout'

// Executive Overview lands first — single-screen pulse of the whole clinic.
// Financial / Operational / Patient / Workforce / Specialist / Clinical /
// Compliance drill into the underlying domains.
const ANALYTICS_NAV: MiniSidebarItem[] = [
  { label: 'Overview', to: '/analytics/overview', icon: LayoutDashboard },
  { label: 'Financial', to: '/analytics/financial', icon: TrendingUp },
  { label: 'Operational', to: '/analytics/operational', icon: Activity },
  { label: 'Patient', to: '/analytics/patient', icon: Users },
  { label: 'Workforce', to: '/analytics/workforce', icon: Briefcase },
  { label: 'Specialist', to: '/analytics/specialist', icon: Stethoscope },
  { label: 'Clinical', to: '/analytics/clinical', icon: HeartPulse },
  { label: 'Store', to: '/analytics/store', icon: Package },
  { label: 'CRM', to: '/analytics/crm', icon: MessageSquare },
  { label: 'Insurance', to: '/analytics/insurance', icon: Umbrella },
  { label: 'Compliance', to: '/analytics/compliance', icon: ShieldCheck },
  { label: 'Data Integrity', to: '/analytics/data-integrity', icon: Database },
]

export function AnalyticsLayout() {
  return (
    <AnalyticsPeriodProvider>
      <MiniSidebarLayout title="Analytics" items={ANALYTICS_NAV} headerSlot={<AnalyticsHeader />}>
        <Outlet />
      </MiniSidebarLayout>
    </AnalyticsPeriodProvider>
  )
}
