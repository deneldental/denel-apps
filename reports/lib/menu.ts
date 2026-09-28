import {
  BarChart2,
  DollarSign,
  FileText,
  LayoutDashboard,
  Settings,
  Stethoscope,
  Users,
} from 'lucide-react'

export type NavItem = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  /** Matches the section key in the injection config */
  section: string
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard, section: 'overview' },
  { label: 'Patient Records', href: '/patient-records', icon: Users, section: 'patient_records' },
  { label: 'Clinical', href: '/clinical', icon: Stethoscope, section: 'clinical' },
  { label: 'Finance', href: '/finance', icon: DollarSign, section: 'finance' },
  { label: 'Reports', href: '/reports', icon: FileText, section: 'reports' },
  { label: 'Analytics', href: '/analytics', icon: BarChart2, section: 'analytics' },
  { label: 'Settings', href: '/settings', icon: Settings, section: 'settings' },
]
