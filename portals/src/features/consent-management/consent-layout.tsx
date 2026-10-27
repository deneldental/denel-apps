import { ClipboardList, PenLine, Scissors, ShieldAlert, Signature } from 'lucide-react'
import { type MiniSidebarItem, MiniSidebarLayout } from '@/shared/components/mini-sidebar-layout'

const CONSENT_NAV: MiniSidebarItem[] = [
  // Each tab needs the module the route guard requires for its page (route-access),
  // so a tab is only offered where the click would stay on the page. A doctor holds
  // ortho_consent but not compliance, so Ortho is theirs and the rest are not.
  // There is no Templates tab: its actions led to the removed Documents pages and
  // nothing can create a template (decision D5). Restore it with Documents v3.
  { label: 'All Consents', to: '/consents', icon: ClipboardList, permission: 'compliance' },
  { label: 'Pending', to: '/consents/pending', icon: ShieldAlert, permission: 'compliance' },
  { label: 'Ortho', to: '/consents/ortho', icon: PenLine, permission: 'ortho_consent' },
  { label: 'Surgical', to: '/consents/surgical', icon: Scissors, permission: 'compliance' },
  { label: 'Sign', to: '/consents/sign', icon: Signature, permission: 'compliance' },
]

export function ConsentLayout() {
  return <MiniSidebarLayout title="Consents" items={CONSENT_NAV} />
}
