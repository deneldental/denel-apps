import { BookOpen, ClipboardList, PenLine, Scissors, ShieldAlert, Signature } from 'lucide-react'
import { type MiniSidebarItem, MiniSidebarLayout } from '@/shared/components/mini-sidebar-layout'

const CONSENT_NAV: MiniSidebarItem[] = [
  { label: 'All Consents', to: '/consents', icon: ClipboardList },
  { label: 'Pending', to: '/consents/pending', icon: ShieldAlert },
  { label: 'Templates', to: '/consents/templates', icon: BookOpen },
  { label: 'Ortho', to: '/consents/ortho', icon: PenLine },
  { label: 'Surgical', to: '/consents/surgical', icon: Scissors },
  { label: 'Sign', to: '/consents/sign', icon: Signature },
]

export function ConsentLayout() {
  return <MiniSidebarLayout title="Consents" items={CONSENT_NAV} />
}
