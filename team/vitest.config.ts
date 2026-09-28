import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // @vitejs/plugin-react v6 uses Rolldown which doesn't integrate with
  // Vitest's transform pipeline. Use esbuild's built-in JSX transform instead.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['**/node_modules/**', '**/tests/e2e/**', '**/dist/**'],
    // Prevent module graph tracing from loading heavy production deps
    server: {
      deps: {
        // Do not pre-bundle these — vitest will mock them before they load
        inline: ['better-auth', 'workbox-window'],
      },
    },
  },
})
