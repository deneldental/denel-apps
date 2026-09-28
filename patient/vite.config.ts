import path from 'node:path'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Sentry source-map upload runs only when an auth token is present —
// CI sets SENTRY_AUTH_TOKEN via Doppler; local dev builds skip the upload.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const SENTRY_ORG = process.env.SENTRY_ORG ?? 'framada-dental'
const SENTRY_PROJECT = process.env.PATIENT_SENTRY_PROJECT ?? 'framada-patient'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // Plugin order: react → sentry → VitePWA (maps uploaded before SW pre-cache).
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: SENTRY_ORG,
            project: SENTRY_PROJECT,
            authToken: sentryAuthToken,
            sourcemaps: {
              assets: 'dist/**',
              filesToDeleteAfterUpload: ['dist/**/*.map'],
            },
            release: {
              name: process.env.VITE_GIT_SHA ?? `patient@${new Date().toISOString()}`,
              deploy: process.env.VITE_APP_ENV ? { env: process.env.VITE_APP_ENV } : undefined,
            },
          }),
        ]
      : []),
    ...(process.env.ANALYZE === '1'
      ? [
          visualizer({
            filename: 'dist/bundle-stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
    VitePWA({
      // 'prompt' — surface a toast so the patient chooses when to reload, rather
      // than forcing skip-waiting under their feet.
      registerType: 'prompt',
      injectRegister: null,
      srcDir: 'src',
      strategies: 'generateSW',
      devOptions: {
        enabled: false,
      },
      manifest: {
        name: 'Denel Dental Clinic',
        short_name: 'Denel',
        description: 'Book appointments, view your records, and manage payments',
        theme_color: '#24296a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait',
        // Denel app icon — the portal's family: navy tile, gold mark. The
        // 192/512 tiles are full-bleed and opaque; the maskable variant keeps
        // the mark at 55% so it sits inside Android's safe circle.
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          // Public-only API endpoints. Authenticated /api/* routes are deliberately
          // NOT cached — Workbox has no concept of cookies, so a cached response on
          // a shared device could leak between patients. (Patient app caches its own
          // /api/patient-portal/* selectively in a later phase.)
          {
            urlPattern: /\/api\/integrations\/branding\/public/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'public-api-cache',
              networkTimeoutSeconds: 10,
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'font-cache',
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  define: {
    // Patient app's own public URL + Sentry project; remapped from Doppler
    // PATIENT_VITE_* to the shared VITE_* names the app code reads.
    'import.meta.env.VITE_APP_URL': JSON.stringify(process.env.PATIENT_VITE_APP_URL ?? ''),
    // Must also be declared in turbo.json's `build.env` or strict env mode
    // filters it out. Falls back to VITE_SENTRY_DSN so this define can never
    // blank out a DSN the environment did supply.
    'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(
      process.env.PATIENT_VITE_SENTRY_DSN ?? process.env.VITE_SENTRY_DSN ?? ''
    ),
    // Dev only: force a RELATIVE API base ('') so the app is same-origin with
    // its own dev server (whatever port Vite picks) and the `/api` proxy below
    // forwards to the backend — no cross-origin CORS. Production builds keep the
    // real injected VITE_API_URL.
    ...(command === 'serve' ? { 'import.meta.env.VITE_API_URL': JSON.stringify('') } : {}),
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5177,
    // Local dev: proxy /api to the backend so the patient app is same-origin
    // with its API (cookies/CSRF work without cross-origin CORS). Set
    // VITE_API_URL=http://localhost:5177 when running the dev server. Ignored by
    // production builds, which use the real injected VITE_API_URL.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    sourcemap: Boolean(process.env.SENTRY_AUTH_TOKEN),
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pdf-lib')) {
            return 'vendor-pdf'
          }
          if (id.includes('node_modules/@tanstack')) {
            return 'vendor-tanstack'
          }
        },
      },
    },
  },
}))
