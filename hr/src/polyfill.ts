import { Buffer } from 'buffer'

// Some deps (e.g. legacy Node-oriented libraries pulled in transitively)
// expect these three Node globals to exist even in a browser bundle.
declare global {
  interface Window {
    Buffer: typeof Buffer
    global: typeof globalThis
    process: { env: Record<string, string | undefined> }
  }
}

if (typeof window !== 'undefined') {
  window.Buffer = Buffer
  window.global = window
  window.process = { env: {} }
}
