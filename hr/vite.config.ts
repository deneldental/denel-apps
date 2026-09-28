import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const DEV_ORIGIN = 'http://localhost:5176'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), tsconfigPaths()],
  // Dedupe React so the workspace @denel/ui package (and its radix deps) share
  // the app's single React instance — otherwise radix hooks hit a null dispatcher
  // ("Cannot read properties of null (reading 'useRef')").
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    // Distinct dev port so HR can run alongside portal (5173) / pwa (5174) /
    // reports (5175). Mapped to the 'hr' interface in backend detectInterface.
    port: 5176,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  define: {
    // VITE_API_URL and VITE_BETTER_AUTH_URL are shared across all apps and
    // picked up directly from env by Vite. Only app-specific vars need remapping.
    'import.meta.env.VITE_APP_URL': JSON.stringify(process.env.HR_VITE_APP_URL ?? ''),
    // Each Vite app has its own Sentry project so events don't cross-pollute.
    // HR_VITE_SENTRY_DSN lives in Doppler; remapped to the shared VITE_SENTRY_DSN
    // name that error-reporting.ts reads.
    // Must also be declared in turbo.json's `build.env` or strict env mode
    // filters it out. Falls back to VITE_SENTRY_DSN so this define can never
    // blank out a DSN the environment did supply.
    'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(
      process.env.HR_VITE_SENTRY_DSN ?? process.env.VITE_SENTRY_DSN ?? ''
    ),
    // Local dev only: point the API + Better-Auth base at this app's own origin
    // so requests are same-origin and Vite's `/api` proxy forwards them to the
    // backend. Avoids needing the HR dev origin in the backend's
    // ALLOWED_ORIGINS allowlist. Production builds use the real injected URLs.
    ...(command === 'serve'
      ? {
          'import.meta.env.VITE_API_URL': JSON.stringify(DEV_ORIGIN),
          'import.meta.env.VITE_BETTER_AUTH_URL': JSON.stringify(DEV_ORIGIN),
        }
      : {}),
    'process.env': {},
    global: 'window',
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Separate chunks for heavy libraries so the initial bundle stays lean.
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'vendor-charts'
          }
          if (id.includes('node_modules/@tanstack')) {
            return 'vendor-tanstack'
          }
        },
      },
    },
  },
}))
