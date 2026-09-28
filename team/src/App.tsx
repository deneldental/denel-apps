import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import DoctorLayout from '@/layouts/DoctorLayout'
import LabTechLayout from '@/layouts/LabTechLayout'
import StaffLayout from '@/layouts/StaffLayout'
import { AuthProvider, useAuth } from '@/lib/auth'
// ─── Auth pages (eager — needed before any role tree resolves) ─────────────
import LoginPage from '@/pages/auth/LoginPage'

// Public staff self-registration (no auth) — lazy so it stays out of the main bundle.
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'))

import { AppErrorBoundary } from '@/shared/components/app-error-boundary'
import { BrandLoader } from '@/shared/components/BrandLoader'
import { RequireRole } from '@/shared/components/require-role'
import { RequireTeamAccess } from '@/shared/components/require-team-access'
import { RouteSkeleton } from '@/shared/components/route-skeleton'
import { getHomeForRole } from '@/shared/lib/role-routing'

// ─── Lazy chunks per role tree ─────────────────────────────────────────────
// React.lazy splits each page into its own chunk. Grouping by role means a
// staff member never downloads doctor/lab/trainer code (and vice-versa).

// Staff hub
const AssessmentsPage = lazy(() => import('@/pages/AssessmentsPage'))
const BreakfastPage = lazy(() => import('@/pages/BreakfastPage'))
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const DocumentsPage = lazy(() => import('@/pages/DocumentsPage'))
const InfoHubPage = lazy(() => import('@/pages/InfoHubPage'))
const MemosPage = lazy(() => import('@/pages/MemosPage'))
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'))
const TasksPage = lazy(() => import('@/pages/TasksPage'))
const PerformancePage = lazy(() => import('@/pages/PerformancePage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const HrHandbookPage = lazy(() => import('@/pages/HrHandbookPage'))
const TrainingPage = lazy(() => import('@/pages/TrainingPage'))
const NewRequestPage = lazy(() => import('@/pages/requests/NewRequestPage'))
const RequestsListPage = lazy(() => import('@/pages/requests/RequestsListPage'))
const SuggestionsPage = lazy(() => import('@/pages/requests/SuggestionsPage'))
const AttendancePage = lazy(() => import('@/pages/staff/AttendancePage'))
const PayslipsPage = lazy(() => import('@/pages/staff/PayslipsPage'))

// Doctor
const DoctorAppointmentDetailPage = lazy(() => import('@/pages/doctor/AppointmentDetailPage'))
const DoctorHomePage = lazy(() => import('@/pages/doctor/HomePage'))
const DoctorPatientMiniProfilePage = lazy(() => import('@/pages/doctor/PatientMiniProfilePage'))
const DoctorPatientSearchPage = lazy(() => import('@/pages/doctor/PatientSearchPage'))
const DoctorProfilePage = lazy(() => import('@/pages/doctor/ProfilePage'))
const DoctorQuickNoteIndexPage = lazy(() => import('@/pages/doctor/QuickNoteIndexPage'))
const DoctorSchedulePage = lazy(() => import('@/pages/doctor/SchedulePage'))

// Lab tech
const LabCaseNotesPage = lazy(() => import('@/pages/lab/LabCaseNotesPage'))
const LabHomePage = lazy(() => import('@/pages/lab/LabHomePage'))
const LabJobDetailPage = lazy(() => import('@/pages/lab/LabJobDetailPage'))
const LabJobsPage = lazy(() => import('@/pages/lab/LabJobsPage'))
const LabTechProfilePage = lazy(() => import('@/pages/lab/LabTechProfilePage'))

function RootRedirect() {
  const { user, loading: staffLoading } = useAuth()

  if (staffLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <BrandLoader />
      </div>
    )
  }

  // user.roleId carries the RBAC slug; user.role is Better Auth's admin
  // plugin field ('admin' / 'user' / 'external_trainer'). Without preferring
  // roleId, every non-admin staff would fall through to '/login' here.
  if (user) return <Navigate to={getHomeForRole(user.roleId ?? user.role)} replace />
  return <Navigate to="/login" replace />
}

function ComingSoonPlaceholder({ label, screen }: { label: string; screen: string }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="rounded-lg border border-border bg-card p-6 text-center max-w-sm w-full">
        <h1 className="text-lg font-semibold mb-1">
          {label} {screen}
        </h1>
        <p className="text-sm text-muted-foreground">coming Wave 3</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />

          {/* Auth Routes (no layout, eagerly loaded) */}
          <Route path="/login" element={<LoginPage />} />

          {/* Public staff self-registration (no auth, no layout) */}
          <Route
            path="/register/:token"
            element={
              <Suspense fallback={<RouteSkeleton />}>
                <RegisterPage />
              </Suspense>
            }
          />

          {/* Staff hub Routes — guard + scoped error boundary + Suspense fallback */}
          <Route
            element={
              <RequireRole roles={['staff']}>
                <RequireTeamAccess>
                  <AppErrorBoundary scope="staff">
                    <Suspense fallback={<RouteSkeleton />}>
                      <StaffLayout />
                    </Suspense>
                  </AppErrorBoundary>
                </RequireTeamAccess>
              </RequireRole>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/requests" element={<RequestsListPage />} />
            <Route path="/requests/new" element={<NewRequestPage />} />
            <Route path="/suggestions" element={<SuggestionsPage />} />
            <Route path="/training" element={<TrainingPage />} />
            <Route path="/info-hub" element={<InfoHubPage />} />
            {/* /attendance-hub was the old standalone hub; its register + fix-request
                flow now lives on /attendance. Redirect old bookmarks there. */}
            <Route path="/attendance-hub" element={<Navigate to="/attendance" replace />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/memos" element={<MemosPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/assessments" element={<AssessmentsPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/breakfast" element={<BreakfastPage />} />
            <Route path="/handbook" element={<HrHandbookPage />} />
            <Route path="/payslips" element={<PayslipsPage />} />
            <Route
              path="/staff"
              element={<ComingSoonPlaceholder label="Staff" screen="Directory" />}
            />
          </Route>

          {/* Lab Technician Routes */}
          <Route
            element={
              <RequireRole roles={['lab_technician']}>
                <RequireTeamAccess>
                  <AppErrorBoundary scope="lab">
                    <Suspense fallback={<RouteSkeleton />}>
                      <LabTechLayout />
                    </Suspense>
                  </AppErrorBoundary>
                </RequireTeamAccess>
              </RequireRole>
            }
          >
            <Route path="/lab/home" element={<LabHomePage />} />
            <Route path="/lab/jobs" element={<LabJobsPage />} />
            <Route path="/lab/jobs/:id" element={<LabJobDetailPage />} />
            <Route path="/lab/jobs/:id/notes" element={<LabCaseNotesPage />} />
            <Route path="/lab/profile" element={<LabTechProfilePage />} />
          </Route>

          {/* Doctor Routes — unreachable by policy.
              Doctors hold no 'pwa' interface scope, so RequireTeamAccess denies
              before any of these render. The tree is kept rather than deleted so
              the decision stays reversible; delete it once v2 has settled. */}
          <Route
            element={
              <RequireRole roles={['doctor']}>
                <RequireTeamAccess>
                  <AppErrorBoundary scope="doctor">
                    <Suspense fallback={<RouteSkeleton />}>
                      <DoctorLayout />
                    </Suspense>
                  </AppErrorBoundary>
                </RequireTeamAccess>
              </RequireRole>
            }
          >
            <Route path="/doctor/home" element={<DoctorHomePage />} />
            <Route path="/doctor/today" element={<DoctorSchedulePage />} />
            <Route path="/doctor/appointments/:id" element={<DoctorAppointmentDetailPage />} />
            <Route path="/doctor/patients" element={<DoctorPatientSearchPage />} />
            <Route path="/doctor/patients/:id" element={<DoctorPatientMiniProfilePage />} />
            <Route path="/doctor/notes" element={<DoctorQuickNoteIndexPage />} />
            <Route path="/doctor/profile" element={<DoctorProfilePage />} />
          </Route>

          {/* 404 */}
          <Route
            path="*"
            element={
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100vh',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>404</h1>
                <p style={{ color: 'var(--text-muted)' }}>Page not found</p>
              </div>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
