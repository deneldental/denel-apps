import {
  Activity,
  Bell,
  MessageSquare,
  PartyPopper,
  RefreshCw,
  Repeat,
  Settings,
} from 'lucide-react'
import { type MiniSidebarItem, MiniSidebarLayout } from '@/shared/components/mini-sidebar-layout'

const CRM_NAV: MiniSidebarItem[] = [
  { label: 'SMS', to: '/crm/messaging', icon: MessageSquare },
  { label: 'Comms Health', to: '/crm/health', icon: Activity },
  { label: 'Google Sync', to: '/crm/sync', icon: RefreshCw },
  { label: 'SMS Templates', to: '/crm/sms-templates', icon: Bell },
  { label: 'Recare', to: '/crm/recare', icon: Repeat },
  { label: 'Holidays', to: '/crm/holidays', icon: PartyPopper },
  { label: 'Settings', to: '/crm/settings', icon: Settings },
]

export function CrmLayout() {
  return <MiniSidebarLayout title="CRM" items={CRM_NAV} />
}
