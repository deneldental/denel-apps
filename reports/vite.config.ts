import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: { dedupe: ['react', 'react-dom'] },
  envPrefix: 'VITE_',
  define: {
    // VITE_API_URL is shared across all apps and picked up directly from env by Vite.
    // Only app-specific vars need remapping.
    'import.meta.env.VITE_APP_URL': JSON.stringify(process.env.REPORTS_VITE_APP_URL ?? ''),
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
})
