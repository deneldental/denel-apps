import './polyfill.ts'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App.tsx'
import { validateHrEnv } from './config/env'
import { api } from './lib/api'
import { attachGlobalErrorHandlers, initErrorReporting } from './shared/lib/error-reporting'
// Brand fonts, self-hosted exactly like the portal (no Google Fonts CDN):
// Montserrat for UI text, Playfair Display for titles via `font-heading`.
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/playfair-display/400.css'
import '@fontsource/playfair-display/700.css'
import './globals.css'

// Validate env vars at boot — throws with a readable message if any required
// VITE_* var is missing, so CI/preview deploys fail loudly.
validateHrEnv()

// Initialise error reporting (Sentry if DSN present, else no-op).
void initErrorReporting()
attachGlobalErrorHandlers()

// A 401 from any REST call means the session died mid-use (backend restart,
// idle past the session TTL, banned elsewhere) — without this, every page
// keeps looking logged-in while every fetch/mutation silently fails, with no
// path back to login short of a manual hard refresh. Mirrors team/patient's
// identical wiring in their own main.tsx.
api.setOnSessionExpired((_path) => {
  const current = window.location.pathname
  if (current.startsWith('/auth/login') || current.startsWith('/auth/forgot-password')) return
  window.location.href = '/auth/login'
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
