import logoUrl from '@denel/assets/logo.png'
import { AppHeader, type BottomTabItem, BottomTabNav } from '@denel/ui/blocks'
import { ClipboardList, Home, User } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useStaffNotifications } from '@/lib/use-notifications'
import { InstallBanner } from '@/shared/components/install-banner'

// Lab tech's primary surface is the PWA (per product spec). Route-level
// RequireRole in App.tsx already guards entry.
const tabs: BottomTabItem[] = [
  { label: 'Home', to: '/lab/home', icon: Home },
  { label: 'Jobs', to: '/lab/jobs', icon: ClipboardList },
  { label: 'Profile', to: '/lab/profile', icon: User },
]

export default function LabTechLayout() {
  const { user } = useAuth()
  const { count: notifCount } = useStaffNotifications()
  return (
    <div className="flex flex-col h-full">
      <AppHeader
        logoUrl={logoUrl}
        logoAlt="Denel Dental Clinic"
        notifications={{ count: notifCount, to: '/notifications' }}
        avatar={{ name: user?.name, imageUrl: user?.image, to: '/lab/profile' }}
      />
      <main
        className="scroll-area flex-1"
        style={{ paddingBottom: 'calc(var(--nav-height) + var(--safe-bottom))' }}
      >
        <Outlet />
      </main>
      <BottomTabNav items={tabs} ariaLabel="Lab technician navigation" />
      <InstallBanner />
    </div>
  )
}
