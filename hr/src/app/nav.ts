import {
  BookText,
  CalendarClock,
  CalendarRange,
  Clock,
  Coffee,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Network,
  Percent,
  Receipt,
  Settings,
  ShieldCheck,
  Star,
  StickyNote,
  Users,
  Wallet,
} from 'lucide-react'
import type { ComponentType } from 'react'

/** Feature flags (HrFeatures) that gate a nav item's visibility. */
export type NavFeature = 'rosterEnabled' | 'orgChartEnabled' | 'reviewCyclesEnabled'

export interface NavItem {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  /** When set, the item is only shown if this HR feature flag is enabled. */
  feature?: NavFeature
  /** When true, only the Admin role sees this item (RBAC admin surfaces). */
  adminOnly?: boolean
  /** When set, checks if the user has read permission on this module. */
  module?: string
}

/**
 * HR app navigation — a single flat list of links (no grouping / accordions).
 * The HR app is one domain, so every section is a top-level destination.
 * Items with a `feature` are filtered out when that flag is off (Settings →
 * Features), so disabling Roster / Org Chart / Review Cycles also hides them.
 */
export const HR_NAV: NavItem[] = [
  { label: 'Overview', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Tasks Management', to: '/tasks', icon: ListChecks, module: 'staff' },
  { label: 'Staff', to: '/staff', icon: Users, module: 'staff' },
  { label: 'Attendance', to: '/attendance', icon: Clock, module: 'staff' },
  {
    label: 'Roster',
    to: '/roster',
    icon: CalendarClock,
    feature: 'rosterEnabled',
    module: 'staff',
  },
  { label: 'Requests', to: '/requests', icon: Inbox, module: 'staff' },
  { label: 'Memos', to: '/memos', icon: StickyNote, module: 'staff' },
  { label: 'HR Handbook', to: '/handbook', icon: BookText },
  { label: 'Breakfast', to: '/breakfast', icon: Coffee, module: 'staff' },
  {
    label: 'Org Chart',
    to: '/org-chart',
    icon: Network,
    feature: 'orgChartEnabled',
    module: 'staff',
  },
  { label: 'Payroll Runs', to: '/payroll-runs', icon: Receipt, module: 'payroll' },
  { label: 'Payslips', to: '/payslips', icon: Wallet, module: 'payroll' },
  { label: 'Performance Reviews', to: '/performance', icon: Star, module: 'staff' },
  {
    label: 'Review Cycles',
    to: '/review-cycles',
    icon: CalendarRange,
    feature: 'reviewCyclesEnabled',
    module: 'staff',
  },
  { label: 'Training', to: '/trainer/training', icon: GraduationCap, module: 'staff_training' },
  { label: 'Tax Configuration', to: '/tax-config', icon: Percent, module: 'tax_calculations' },
  { label: 'Access Management', to: '/access-management', icon: ShieldCheck, adminOnly: true },
  { label: 'Settings', to: '/settings', icon: Settings, module: 'staff' },
]
