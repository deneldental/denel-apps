import logoUrl from '@denel/assets/logo.png'
import { AppHeader, BottomTabNav } from '@denel/ui/blocks'
import { Calendar, CreditCard, FileText, Home, Loader2, User } from 'lucide-react'
import { Navigate, Outlet } from 'react-router-dom'
import { usePatientAuth } from '@/lib/patient-auth'
import { usePatientNotifications } from '@/lib/use-notifications'
import { InstallBanner } from '@/shared/components/install-banner'

const tabs = [
  { to: '/patient/home', icon: Home, label: 'Home' },
  { to: '/patient/appointments', icon: Calendar, label: 'Appointments' },
  { to: '/patient/records', icon: FileText, label: 'Records' },
  { to: '/patient/payments', icon: CreditCard, label: 'Payments' },
  { to: '/patient/profile', icon: User, label: 'Profile' },
]

export default function PatientLayout() {
  const { patient, loading } = usePatientAuth()
  const { count } = usePatientNotifications()

  if (loading && !patient) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!patient) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        logoUrl={logoUrl}
        logoAlt="Denel Dental Clinic"
        notifications={{ count, to: '/patient/notifications' }}
        avatar={{ name: patient.name, imageUrl: patient.profileImage, to: '/patient/profile' }}
      />

      <main
        className="scroll-area flex-1"
        style={{ paddingBottom: 'calc(var(--nav-height) + var(--safe-bottom))' }}
      >
        <Outlet />
      </main>

      <InstallBanner />

      <BottomTabNav items={tabs} end={false} />
    </div>
  )
}
