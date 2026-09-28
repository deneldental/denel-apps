import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Integration tests run many sequential queries against the remote dev DB
    // (Neon); the 5s default is not enough once network latency is in the mix.
    // 60s (was 30s) absorbs Neon serverless cold-starts after the branch has
    // been idle — the first query of a run can spike to 20s+ before the
    // compute wakes. Unit tests are unaffected — they finish in milliseconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Run test FILES one at a time. The integration suite hits one shared
    // remote DB, and `concurrency.test.ts` deliberately holds row locks across
    // two transactions — running other files in parallel saturates the DB and
    // makes those lock-waits flake on timeout. Files are sequential; tests
    // within a file still run fast.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/routes/**/*.ts'],
    },
  },
})
