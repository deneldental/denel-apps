import './polyfill'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import { validateReportsEnv } from './config/env'
import { attachGlobalErrorHandlers, initErrorReporting } from './lib/error-reporting'
// Brand fonts, self-hosted exactly like the portal (no Google Fonts CDN):
// Montserrat for UI text, Playfair Display for titles via `font-heading`.
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/playfair-display/400.css'
import '@fontsource/playfair-display/700.css'
import './globals.css' // We'll move this later, but for now point to existing CSS

validateReportsEnv()

// Error reporting (Sentry when a DSN is set, else a no-op). Fire-and-forget.
void initErrorReporting()
attachGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
