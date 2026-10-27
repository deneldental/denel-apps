import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // One React for the package and the testing library, or hooks hit a null dispatcher.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
