import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    // Dedupe React so `@denel/ui` (+ its radix deps) share the app's single
    // React instance — otherwise radix hooks hit a null dispatcher in jsdom
    // ("Cannot read properties of null (reading 'useRef')"). Mirrors vite.config.
    dedupe: ['react', 'react-dom'],
    // tsconfig.json restricts `include` to `src`, so vite-tsconfig-paths
    // doesn't apply the `@/*` mapping to imports from `tests/`. Mirror the
    // alias explicitly so component smoke-tests can `import from '@/...'`.
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['**/node_modules/**', '**/tests/e2e/**', '**/dist/**'],
    // Run all portal test files in a single fork process. The default mode
    // spawns a new fork per-file; heavy Radix UI/jsdom combinations can exhaust
    // the GitHub Actions runner heap and cause the worker to exit unexpectedly.
    // singleFork collapses all files into one process, eliminating repeated
    // jsdom + React bootstrap costs and staying well within the 7 GB limit.
    // (Vitest 4: singleFork is a top-level test option, poolOptions removed.)
    pool: 'forks',
    singleFork: true,
    // Hard cap per test — surfaces hangs as a clear timeout rather than an
    // opaque "Worker exited unexpectedly" error on CI.
    testTimeout: 30_000,
    // Give the single fork up to 5 minutes to finish all portal tests before
    // Vitest considers it gone.
    forkTimeout: 300_000,
  },
})
