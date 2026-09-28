import path from 'node:path'
import type { NextConfig } from 'next'

// Monorepo root — needed for both Turbopack and file tracing in CI builds.
const monorepoRoot = path.join(__dirname, '..')

// CSP for the public marketing site. Wide-ish on `img-src` because blog/CMS
// content may pull from arbitrary HTTPS image hosts. `connect-src` includes
// the booking-form target (api.deneldental.com /api/website-bookings) and Vercel
// Analytics, which @vercel/analytics posts to vitals.vercel-insights.com.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.deneldental.com https://vitals.vercel-insights.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ')

const nextConfig: NextConfig = {
  // Both must point at the monorepo root for Next 16 / Turbopack to find
  // next/package.json (hoisted to root node_modules in pnpm workspaces).
  // If they disagree, Next.js silently uses outputFileTracingRoot and breaks.
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ]
  },
}

export default nextConfig
