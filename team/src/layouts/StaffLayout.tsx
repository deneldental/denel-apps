import logoUrl from '@denel/assets/logo.png'
import { AppHeader, type BottomTabItem, BottomTabNav } from '@denel/ui/blocks'
import {
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  Home,
  Inbox,
  Receipt,
  Users,
} from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useStaffNotifications } from '@/lib/use-notifications'
import { InstallBanner } from '@/shared/components/install-banner'
import { usePermissions } from '@/shared/hooks/use-permissions'

// Staff hub tabs.
//
// Per product spec (2026-05-31), receptionist on PWA logs in *as Staff* — i.e.
// no patient-attending surfaces. The PWA isn't where clinic-facing receptionist
// work happens (that's the portal). The default strip below is therefore what
// every non-admin staff role gets, including receptionists.
//
// Admins keep a separate strip because they need the "Staff" directory and
// Requests inbox (approval workflow lives there).
function staffTabs(role: string | null | undefined): BottomTabItem[] {
  if (role === 'admin') {
    return [
      { label: 'Home', to: '/dashboard', icon: Home, requiredModule: 'dashboard' },
      { label: 'Payslips', to: '/payslips', icon: Receipt, requiredModule: 'my_payslips' },
      { label: 'Staff', to: '/staff', icon: Users, requiredModule: 'staff' },
      { label: 'Requests', to: '/requests', icon: Inbox, requiredModule: 'my_requests' },
    ]
  }
  // Default — receptionist / nurse / assistant / generic staff. Same strip.
  // Performance moved to a Home card; Payslips lives inside Info Hub. The strip
  // now surfaces Info Hub (Memos + Requests + Payslips) and Profile instead.
  return [
    { label: 'Home', to: '/dashboard', icon: Home, requiredModule: 'dashboard' },
    { label: 'Training', to: '/training', icon: GraduationCap, requiredModule: 'my_training' },
    { label: 'Register', to: '/attendance', icon: CalendarCheck },
    { label: 'Tasks', to: '/tasks', icon: ClipboardList },
    // Breakfast is still in development — the entry point (Profile → Breakfast)
    // shows a "coming soon" toast instead, so no nav tab for it yet.
  ]
}

export default function StaffLayout() {
  const { user } = useAuth()
  const { count: notifCount } = useStaffNotifications()
  const { canAccess, isAdmin, isLoading: permsLoading } = usePermissions()

  // Build the strip, then hide any tab whose required module the user lacks
  // read access to. Admin bypasses (isAdmin short-circuits canAccess to true).
  // While permissions are loading we show all tabs to avoid a flash of empty
  // nav; the page-level guards still block the underlying routes.
  const allTabs = staffTabs(user?.roleId)
  const tabs = permsLoading
    ? allTabs
    : allTabs.filter((t) => {
        if (!t.requiredModule) return true
        if (isAdmin) return true
        return canAccess(t.requiredModule)
      })

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        logoUrl={logoUrl}
        logoAlt="Denel Dental Clinic"
        notifications={{ count: notifCount, to: '/notifications' }}
        avatar={{ name: user?.name, imageUrl: user?.image, to: '/profile' }}
      />
      <main
        className="scroll-area flex-1"
        style={{ paddingBottom: 'calc(var(--nav-height) + var(--safe-bottom))' }}
      >
        <Outlet />
      </main>
      <BottomTabNav items={tabs} ariaLabel="Staff navigation" />
      <InstallBanner />
    </div>
  )
}
