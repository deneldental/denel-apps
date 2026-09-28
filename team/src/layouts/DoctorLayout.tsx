import logoUrl from '@denel/assets/logo.png'
import { AppHeader, type BottomTabItem, BottomTabNav } from '@denel/ui/blocks'
import { CalendarDays, FileText, Users } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useStaffNotifications } from '@/lib/use-notifications'
import { InstallBanner } from '@/shared/components/install-banner'

// Doctor's primary surface is the portal (per product spec). PWA is supported
// as a secondary on-the-go experience; route-level RequireRole in App.tsx
// guards entry, so no layout-level check needed.
const tabs: BottomTabItem[] = [
  { label: 'Today', to: '/doctor/home', icon: CalendarDays },
  { label: 'Patients', to: '/doctor/patients', icon: Users },
  { label: 'Notes', to: '/doctor/notes', icon: FileText },
]

export default function DoctorLayout() {
  const { user } = useAuth()
  const { count: notifCount } = useStaffNotifications()
  return (
    <div className="flex flex-col h-full">
      <AppHeader
        logoUrl={logoUrl}
        logoAlt="Denel Dental Clinic"
        notifications={{ count: notifCount, to: '/notifications' }}
        avatar={{ name: user?.name, imageUrl: user?.image, to: '/doctor/profile' }}
      />
      <main
        className="scroll-area flex-1"
        style={{ paddingBottom: 'calc(var(--nav-height) + var(--safe-bottom))' }}
      >
        <Outlet />
      </main>
      <BottomTabNav items={tabs} ariaLabel="Doctor navigation" />
      <InstallBanner />
    </div>
  )
}
