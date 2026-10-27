import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// The HR app's tests are for the pure decision logic behind its screens (what a role may be
// offered, when a first password is needed, ...), so a plain Node environment is enough. Anything
// that needs a DOM belongs in a component test with its own setup.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
