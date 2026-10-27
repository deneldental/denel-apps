import { AlertTriangle } from 'lucide-react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { getAllRoutes } from '@/app/modules/registry'
import AnalyticsPrintPage from '@/features/analytics/pages/print'
import AppointmentConfirmPage from '@/features/appointment-confirmation/pages/index'
import DashboardLayout from '@/features/auth/guards/DashboardLayout'
import ChangePasswordPage from '@/features/auth/pages/change-password/index'
import ForgotPasswordPage from '@/features/auth/pages/forgot-password/index'
import LoginPage from '@/features/auth/pages/login/index'
import ResetPasswordPage from '@/features/auth/pages/reset-password/index'
import { PublicSignerPage } from '@/features/documents/pages/public-signer'
import FinancialRecordsPrintPage from '@/features/financial-records/pages/print'
import KioskApp from '@/features/kiosk/pages/index'
import XrayShareViewPage from '@/features/xray-share/pages/index'
import XrayPublicViewerPage from '@/features/xrays/pages/public-viewer'
import { AppErrorBoundary } from '@/shared/components/app-error-boundary'

function PublicPageErrorFallback(_err: Error, reset: () => void) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-gray-50">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
        <p className="text-sm text-gray-500">
          This page encountered an unexpected error. The issue has been reported.
        </p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Legacy /financial-analytics URL — the page now lives at /analytics/financial
          inside the DashboardShell. Keep this redirect for old bookmarks. */}
      <Route path="/financial-analytics" element={<Navigate to="/analytics/financial" replace />} />

      {/* Financial Records print view — content-only layout (no DashboardShell). */}
      <Route path="/financial-records/print" element={<FinancialRecordsPrintPage />} />

      {/* Analytics full-report print view — rendered by the backend Puppeteer
          export endpoint into a PDF. Bare layout, no shell. */}
      <Route path="/analytics/print" element={<AnalyticsPrintPage />} />

      {/* Auth routes */}
      <Route path="/login" element={<Navigate to="/auth/login" replace />} />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/change-password" element={<ChangePasswordPage />} />

      {/* Public appointment confirmation (token-based, no login) */}
      <Route
        path="/c/:token"
        element={
          <AppErrorBoundary scope="appointment-confirm" fallback={PublicPageErrorFallback}>
            <AppointmentConfirmPage />
          </AppErrorBoundary>
        }
      />

      {/* Public X-ray share viewer (token + code, no login) */}
      <Route
        path="/xray-share/:token"
        element={
          <AppErrorBoundary scope="xray-share" fallback={PublicPageErrorFallback}>
            <XrayShareViewPage />
          </AppErrorBoundary>
        }
      />

      {/* Short-link public X-ray viewer (mock flow — UI-only OTP demo) */}
      <Route
        path="/x/:token"
        element={
          <AppErrorBoundary scope="xray-public" fallback={PublicPageErrorFallback}>
            <XrayPublicViewerPage />
          </AppErrorBoundary>
        }
      />

      {/* Public multi-signer document signing (token-based, no login) */}
      <Route
        path="/sign/:token"
        element={
          <AppErrorBoundary scope="public-sign" fallback={PublicPageErrorFallback}>
            <PublicSignerPage />
          </AppErrorBoundary>
        }
      />

      {/* Kiosk device app (CC.3) — standalone, no portal login; authed by device
          token + operator PIN. Lives OUTSIDE DashboardLayout (dashboard unreachable). */}
      <Route
        path="/kiosk/*"
        element={
          <AppErrorBoundary scope="kiosk" fallback={PublicPageErrorFallback}>
            <KioskApp />
          </AppErrorBoundary>
        }
      />

      {/* Protected routes — all modules registered via the module registry */}
      <Route
        element={
          <DashboardLayout>
            <Outlet />
          </DashboardLayout>
        }
      >
        {getAllRoutes()}
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
