import { Loader2 } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import PatientLayout from '@/layouts/PatientLayout'
import { PatientAuthProvider, usePatientAuth } from '@/lib/patient-auth'
import LoginPage from '@/pages/auth/LoginPage'
import OnboardingPage, { hasOnboarded } from '@/pages/onboarding/OnboardingPage'
import { AppErrorBoundary } from '@/shared/components/app-error-boundary'
import { RouteSkeleton } from '@/shared/components/route-skeleton'
import { RequirePatient } from './require-patient'

// Lazy chunks — each patient page is its own bundle.
const ProfileSwitcherPage = lazy(() => import('@/pages/auth/ProfileSwitcherPage'))
const HomePage = lazy(() => import('@/pages/patient/HomePage'))
const AppointmentsPage = lazy(() => import('@/pages/patient/AppointmentsPage'))
const RecordsPage = lazy(() => import('@/pages/patient/RecordsPage'))
const PaymentsPage = lazy(() => import('@/pages/patient/PaymentsPage'))
const ProfilePage = lazy(() => import('@/pages/patient/PatientProfilePage'))
const RemindersPage = lazy(() => import('@/pages/patient/RemindersPage'))
const NotificationsPage = lazy(() => import('@/pages/patient/NotificationsPage'))
const XraysListPage = lazy(() => import('@/pages/patient/XraysListPage'))
const XrayDetailPage = lazy(() => import('@/pages/patient/XrayDetailPage'))

function RootRedirect() {
  const { patient, loading } = usePatientAuth()
  if (loading && !patient) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    )
  }
  if (patient) return <Navigate to="/patient/home" replace />
  // First-time visitors see the onboarding intro once (per device); afterwards
  // they go straight to login.
  return <Navigate to={hasOnboarded() ? '/login' : '/onboarding'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <PatientAuthProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/patient/switch"
            element={
              <RequirePatient>
                <Suspense fallback={<RouteSkeleton />}>
                  <ProfileSwitcherPage />
                </Suspense>
              </RequirePatient>
            }
          />

          <Route
            element={
              <RequirePatient>
                <AppErrorBoundary scope="patient">
                  <Suspense fallback={<RouteSkeleton />}>
                    <PatientLayout />
                  </Suspense>
                </AppErrorBoundary>
              </RequirePatient>
            }
          >
            <Route path="/patient/home" element={<HomePage />} />
            <Route path="/patient/appointments" element={<AppointmentsPage />} />
            <Route path="/patient/records" element={<RecordsPage />} />
            <Route path="/patient/payments" element={<PaymentsPage />} />
            <Route path="/patient/profile" element={<ProfilePage />} />
            <Route path="/patient/reminders" element={<RemindersPage />} />
            <Route path="/patient/notifications" element={<NotificationsPage />} />
            <Route path="/patient/xrays" element={<XraysListPage />} />
            <Route path="/patient/xrays/:id" element={<XrayDetailPage />} />
          </Route>

          <Route
            path="*"
            element={
              <div className="flex h-screen flex-col items-center justify-center gap-2">
                <h1 className="text-3xl font-extrabold">404</h1>
                <p className="text-muted-foreground">Page not found</p>
              </div>
            }
          />
        </Routes>
      </PatientAuthProvider>
    </BrowserRouter>
  )
}
