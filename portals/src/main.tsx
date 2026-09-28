import './polyfill.ts'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App.tsx'
import { validatePortalEnv } from './config/env'
import { attachGlobalErrorHandlers, initErrorReporting } from './shared/lib/error-reporting'
// Self-hosted via @fontsource, never the Google Fonts CDN: a render-blocking
// third-party request is a bad tradeoff on clinic networks. Team, patient, hr
// and reports import the same five files.
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/playfair-display/400.css'
import '@fontsource/playfair-display/700.css'
import './globals.css'
import 'react-odontogram/style.css'

// Validate env vars at boot — throws with a readable message if any required
// VITE_* var is missing, so CI/preview deploys fail loudly.
validatePortalEnv()

// Initialise error reporting (Sentry if DSN present, else no-op).
// Fire-and-forget — Sentry init shouldn't block React mount.
void initErrorReporting()
attachGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
