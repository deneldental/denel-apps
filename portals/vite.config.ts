import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'app-icon.svg', 'apple-touch-icon-180x180.png'],
      workbox: {
        maximumFileSizeToCacheInBytes: 10485760, // 10 MiB
      },
      manifest: {
        name: 'Denel Dental Clinic Management System',
        short_name: 'Denel CMS',
        description: 'Mini Clinic Management System',
        theme_color: '#24296a',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  // Dedupe React so the workspace @denel/ui package (and its radix deps) share
  // the app's single React instance — otherwise radix hooks hit a null dispatcher
  // ("Cannot read properties of null (reading 'useRef')").
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
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
    'import.meta.env.VITE_APP_URL': JSON.stringify(process.env.PORTAL_VITE_APP_URL ?? ''),
    // Each Vite app has its own Sentry project so events don't cross-pollute.
    // PORTAL_VITE_SENTRY_DSN lives in Doppler; remapped to the shared
    // VITE_SENTRY_DSN name that error-reporting.ts reads. It must also be
    // declared in turbo.json's `build.env` or strict env mode filters it out.
    // Falls back to VITE_SENTRY_DSN so this define can never blank out a DSN
    // the environment did supply.
    'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(
      process.env.PORTAL_VITE_SENTRY_DSN ?? process.env.VITE_SENTRY_DSN ?? ''
    ),
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
        // Each chunk is loaded on-demand when the first route that uses it renders.
        manualChunks(id) {
          // recharts + its d3 transitive deps → one chart chunk (~400 KB gzipped)
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'vendor-charts'
          }
          // pdf-lib → loaded only when printing / PDF export actions run
          if (id.includes('node_modules/pdf-lib')) {
            return 'vendor-pdf'
          }
          // xlsx → loaded only on spreadsheet export
          if (id.includes('node_modules/xlsx')) {
            return 'vendor-xlsx'
          }
          // TanStack (Query + Table) in a shared vendor chunk
          if (id.includes('node_modules/@tanstack')) {
            return 'vendor-tanstack'
          }
        },
      },
    },
  },
})
