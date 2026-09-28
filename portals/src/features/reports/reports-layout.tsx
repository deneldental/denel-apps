import { BarChart3, Calendar, CalendarDays, TrendingUp } from 'lucide-react'
import { type MiniSidebarItem, MiniSidebarLayout } from '@/shared/components/mini-sidebar-layout'

// Period rollups (weekly/monthly/quarterly) aggregate the frozen daily
// summaries into a management view — admin-only. Day-to-day staff work from
// Daily Reports.
const REPORTS_NAV: MiniSidebarItem[] = [
  { label: 'Daily Reports', to: '/reports', icon: BarChart3 },
  { label: 'Weekly Summaries', to: '/reports/weekly', icon: CalendarDays, adminOnly: true },
  { label: 'Monthly Summaries', to: '/reports/monthly', icon: Calendar, adminOnly: true },
  { label: 'Quarterly Summaries', to: '/reports/quarterly', icon: TrendingUp, adminOnly: true },
]

export function ReportsLayout() {
  return <MiniSidebarLayout title="Reports" items={REPORTS_NAV} />
}
