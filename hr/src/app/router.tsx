import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
// Eager — auth pages are public entry points that must resolve before any
// protected tree (and its guards), with no Suspense boundary of their own.
import ChangePasswordPage from '@/features/auth/pages/change-password'
import ForgotPasswordPage from '@/features/auth/pages/forgot-password'
import LoginPage from '@/features/auth/pages/login'
import { RequireAuth } from '@/lib/auth'
import { RequireHrAccess } from '@/shared/components/require-hr-access'
import { HrLayout } from './layout'

// Lazily-loaded route chunks. React.lazy splits each page into its own chunk so a
// user downloads only the routes they visit — the trainer tree, payroll, tax, etc.
// no longer ship in the initial bundle. Suspense fallback lives in <HrLayout/>.
const AccessLayout = lazy(() =>
  import('@/features/access-management/access-layout').then((m) => ({ default: m.AccessLayout }))
)
const AccessOverviewPage = lazy(() => import('@/features/access-management/pages/index'))
const AccessRolesPage = lazy(() => import('@/features/access-management/pages/roles'))
const AccessBundlesPage = lazy(() => import('@/features/access-management/pages/bundles'))
const AccessMatrixPage = lazy(() => import('@/features/access-management/pages/matrix'))
const AccessPwaMatrixPage = lazy(() => import('@/features/access-management/pages/pwa-matrix'))
const BreakfastPage = lazy(() => import('@/features/breakfast/pages/index'))
const AttendancePage = lazy(() => import('@/features/staff/pages/attendance'))
const AttendanceDetailPage = lazy(() => import('@/features/staff/pages/attendance-detail'))
const HrDashboardPage = lazy(() => import('@/features/staff/pages/dashboard'))
const StaffDetailPage = lazy(() => import('@/features/staff/pages/detail'))
const MemoDetailPage = lazy(() => import('@/features/staff/pages/memo-detail'))
const MemosPage = lazy(() => import('@/features/staff/pages/memos'))
const HandbookPage = lazy(() => import('@/features/handbook/pages/index'))
const OrgChartPage = lazy(() => import('@/features/staff/pages/org-chart'))
const PayrollRunsPage = lazy(() => import('@/features/staff/pages/payroll-runs'))
const PayslipsAdminPage = lazy(() => import('@/features/staff/pages/payslips'))
const PerformancePage = lazy(() => import('@/features/staff/pages/performance'))
const PerformanceDetailPage = lazy(() => import('@/features/staff/pages/performance-detail'))
const RequestsPage = lazy(() => import('@/features/staff/pages/requests'))
const ReviewCyclesPage = lazy(() => import('@/features/staff/pages/review-cycles'))
const RosterPage = lazy(() => import('@/features/staff/pages/roster'))
const HrSettingsPage = lazy(() => import('@/features/staff/pages/settings'))
const StaffPage = lazy(() => import('@/features/staff/pages/staff'))
const TasksPage = lazy(() => import('@/features/tasks/pages/index'))
const TaxConfigurationPage = lazy(() => import('@/features/tax-config/pages/index'))
const TrainerGradingPage = lazy(() => import('@/pages/trainer/GradingPage'))
const TrainerHomePage = lazy(() => import('@/pages/trainer/HomePage'))
const TrainerLearnerDetailPage = lazy(() => import('@/pages/trainer/LearnerDetailPage'))
const TrainerModuleDetailPage = lazy(() => import('@/pages/trainer/ModuleDetailPage'))
const TrainingPage = lazy(() => import('@/pages/trainer/TrainingPage'))
const TrainerProfilePage = lazy(() => import('@/pages/trainer/ProfilePage'))

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Auth routes (no layout) */}
      <Route path="/login" element={<Navigate to="/auth/login" replace />} />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
      {/* Needs the session, not HR access: RequireAuth sends a person whose password an
          administrator set here, and lets this one path through. */}
      <Route
        path="/auth/change-password"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />

      {/* Protected routes — wrapped in the HR layout shell */}
      <Route
        element={
          <RequireAuth>
            <RequireHrAccess>
              <HrLayout />
            </RequireHrAccess>
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<HrDashboardPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/staff/:id" element={<StaffDetailPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/attendance/:staffId" element={<AttendanceDetailPage />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/performance/:staffId" element={<PerformanceDetailPage />} />
        <Route path="/payroll-runs" element={<PayrollRunsPage />} />
        <Route path="/payslips" element={<PayslipsAdminPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/memos" element={<MemosPage />} />
        <Route path="/memos/:id" element={<MemoDetailPage />} />
        <Route path="/handbook" element={<HandbookPage />} />
        <Route path="/breakfast" element={<BreakfastPage />} />
        <Route path="/review-cycles" element={<ReviewCyclesPage />} />
        <Route path="/roster" element={<RosterPage />} />
        <Route path="/org-chart" element={<OrgChartPage />} />
        <Route path="/settings" element={<HrSettingsPage />} />

        {/* Access Management (RBAC admin) — admin-gated inside the layout */}
        <Route path="/access-management" element={<AccessLayout />}>
          <Route index element={<AccessOverviewPage />} />
          <Route path="roles" element={<AccessRolesPage />} />
          <Route path="bundles" element={<AccessBundlesPage />} />
          <Route path="matrix" element={<AccessMatrixPage />} />
          <Route path="pwa-matrix" element={<AccessPwaMatrixPage />} />
        </Route>
        <Route path="/tax-config" element={<TaxConfigurationPage />} />

        {/* Training authoring (hr_admin + external_trainer) — one hub, three tabs */}
        <Route path="/trainer/home" element={<TrainerHomePage />} />
        <Route path="/trainer/training" element={<TrainingPage />} />
        {/* Legacy list routes now fold into the Training hub's tabs. */}
        <Route
          path="/trainer/modules"
          element={<Navigate to="/trainer/training?tab=modules" replace />}
        />
        <Route path="/trainer/modules/:id" element={<TrainerModuleDetailPage />} />
        <Route
          path="/trainer/learners"
          element={<Navigate to="/trainer/training?tab=learners" replace />}
        />
        <Route path="/trainer/learners/:id" element={<TrainerLearnerDetailPage />} />
        <Route
          path="/trainer/assessments"
          element={<Navigate to="/trainer/training?tab=assessments" replace />}
        />
        <Route path="/trainer/assessments/:id" element={<TrainerGradingPage />} />
        <Route path="/trainer/profile" element={<TrainerProfilePage />} />
      </Route>

      <Route
        path="*"
        element={
          <div className="p-8 text-center">
            <h1 className="text-2xl font-bold">404 — Page Not Found</h1>
          </div>
        }
      />
    </Routes>
  )
}
