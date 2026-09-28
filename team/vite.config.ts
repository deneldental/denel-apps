import path from 'node:path'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Sentry source-map upload runs only when an auth token is present —
// CI sets SENTRY_AUTH_TOKEN via Doppler; local dev builds skip the upload
// step (sourcemaps still emit; just nothing is shipped to Sentry).
// Org + project come from Doppler (SENTRY_ORG, PWA_SENTRY_PROJECT) when set, with
// the current names as fallback; the only real secret is SENTRY_AUTH_TOKEN.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const SENTRY_ORG = process.env.SENTRY_ORG ?? 'framada-dental'
const SENTRY_PROJECT = process.env.PWA_SENTRY_PROJECT ?? 'framada-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Source maps must be uploaded BEFORE the SW pre-cache pass so the SW
    // doesn't see the .map files as cacheable assets. Plugin order:
    // react → sentry → VitePWA.
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: SENTRY_ORG,
            project: SENTRY_PROJECT,
            authToken: sentryAuthToken,
            sourcemaps: {
              assets: 'dist/**',
              // Delete .map files after upload — Sentry has them, shipping
              // them to browsers exposes source code and inflates payload.
              filesToDeleteAfterUpload: ['dist/**/*.map'],
            },
            release: {
              name: process.env.VITE_GIT_SHA ?? `pwa@${new Date().toISOString()}`,
              deploy: process.env.VITE_APP_ENV ? { env: process.env.VITE_APP_ENV } : undefined,
            },
          }),
        ]
      : []),
    // ANALYZE=1 emits a treemap at dist/bundle-stats.html for chunk auditing.
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
      // 'prompt' instead of 'autoUpdate' — we surface a toast to the user
      // (see src/shared/components/sw-update-prompt.tsx) so they choose
      // when to reload, rather than us forcing skip-waiting under their
      // feet mid-quiz.
      registerType: 'prompt',
      injectRegister: null,
      srcDir: 'src',
      strategies: 'generateSW',
      devOptions: {
        enabled: false,
      },
      manifest: {
        name: 'Denel Staff',
        short_name: 'Denel Staff',
        description: 'Denel clinic staff and patient companion',
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
        // Append our Web Push handlers to the generated Workbox SW (generateSW
        // has no push support on its own). push-sw.js displays incoming pushes
        // and routes notification clicks to the payload's `url`.
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          // Public-only API endpoints. Authenticated /api/* routes are
          // deliberately NOT cached — Workbox has no concept of cookies, so
          // on a shared device user A's cached response can be served to
          // user B. React Query / the browser's HTTP cache handle the rest.
          {
            urlPattern: /\/api\/integrations\/branding\/public/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'public-api-cache',
              networkTimeoutSeconds: 10,
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'font-cache',
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
        ],
      },
    }),
  ],
  define: {
    // VITE_API_URL and VITE_BETTER_AUTH_URL are shared across all apps and
    // picked up directly from env by Vite. Only app-specific vars need remapping.
    'import.meta.env.VITE_APP_URL': JSON.stringify(process.env.PWA_VITE_APP_URL ?? ''),
    // Each Vite app has its own Sentry project so events don't cross-pollute.
    // PWA_VITE_SENTRY_DSN lives in Doppler; remapped to the shared VITE_SENTRY_DSN
    // name that error-reporting.ts reads.
    // Must also be declared in turbo.json's `build.env` or strict env mode
    // filters it out. Falls back to VITE_SENTRY_DSN so this define can never
    // blank out a DSN the environment did supply.
    'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(
      process.env.PWA_VITE_SENTRY_DSN ?? process.env.VITE_SENTRY_DSN ?? ''
    ),
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5175,
  },
  build: {
    // Source maps are only emitted when SENTRY_AUTH_TOKEN is present (CI).
    // The Sentry plugin then uploads and strips them from dist/ before deploy.
    // Without the token (local dev, forks) no .map files are produced, so
    // sourcemaps never accidentally ship to browsers.
    sourcemap: Boolean(process.env.SENTRY_AUTH_TOKEN),
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'vendor-charts'
          }
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
})
