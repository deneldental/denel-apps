/**
 * Private files are served from R2 (`<bucket>.<account>.r2.cloudflarestorage.com`
 * signed links; branding from `pub-….r2.dev`). Each deployed app's security
 * policy must allow those hosts wherever files are used — images were already
 * open (`img-src … https:`), but PDF frames, audio/video and script-driven
 * downloads (fetch) were not, so private files would break only in production.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const APPS = ['portals', 'team', 'patient', 'hr', 'reports'] as const
const R2_SOURCES = ['https://*.r2.cloudflarestorage.com', 'https://*.r2.dev']

function cspOf(app: string): string {
  const file = readFileSync(resolve(__dirname, '../../..', app, 'public/_headers'), 'utf8')
  const line = file.split('\n').find((l) => l.includes('Content-Security-Policy:'))
  if (!line) throw new Error(`${app}: no Content-Security-Policy line`)
  return line
}

function directive(csp: string, name: string): string | null {
  const match = csp.match(new RegExp(`(?:^|;)\\s*${name}\\s([^;]*)`))
  return match ? match[1] : null
}

describe.each(APPS)('%s security policy', (app) => {
  it('lets scripts fetch files from R2 (connect-src)', () => {
    const sources = directive(cspOf(app), 'connect-src')
    for (const source of R2_SOURCES) expect(sources).toContain(source)
  })

  it('lets embedded viewers frame files from R2 (frame-src)', () => {
    const sources = directive(cspOf(app), 'frame-src')
    for (const source of R2_SOURCES) expect(sources).toContain(source)
  })

  it('still shows images from anywhere over https (img-src)', () => {
    expect(directive(cspOf(app), 'img-src')).toContain('https:')
  })
})

describe('portal media', () => {
  it('lets the portal play the uploaded alert sound (media-src)', () => {
    const sources = directive(cspOf('portals'), 'media-src')
    expect(sources).toContain('https:')
  })
})
