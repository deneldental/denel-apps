import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
// Brand fonts, self-hosted exactly like the portal (no Google Fonts CDN):
// Montserrat for UI text, Playfair Display for titles via `font-heading`.
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/playfair-display/400.css'
import '@fontsource/playfair-display/700.css'
import './index.css'
import App from './App'
import { validatePwaEnv } from './config/env'
import { setOnSessionExpired } from './lib/api'
import { AppErrorBoundary } from './shared/components/app-error-boundary'
import { OfflineBanner } from './shared/components/offline-banner'
import { SWUpdatePrompt } from './shared/components/sw-update-prompt'
import { attachGlobalErrorHandlers, initErrorReporting } from './shared/lib/error-reporting'

// Validate env vars at boot — throws with a readable message if any required
// VITE_* var is missing, so CI/preview deploys fail loudly instead of silently
// defaulting to localhost.
validatePwaEnv()

// Initialise error reporting (Sentry if DSN present, else no-op).
// Fire-and-forget — Sentry init shouldn't block React mount.
void initErrorReporting()
attachGlobalErrorHandlers()

// Centralised 401 handler — invoked by the api client when any request returns
// session-expired. Skip auth-probing paths that are *expected* to 401 before
// login (getSession polling). Otherwise send the user back to the login screen.
setOnSessionExpired((path) => {
  if (path.includes('/api/auth/get-session')) {
    return
  }
  const current = window.location.pathname
  if (current.startsWith('/login') || current.startsWith('/forgot-password')) {
    return
  }
  window.location.href = '/login'
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary scope="root">
      <SWUpdatePrompt />
      <OfflineBanner />
      <App />
      <Toaster position="top-center" richColors closeButton />
    </AppErrorBoundary>
  </StrictMode>
)
