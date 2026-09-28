/**
 * Team & patient upload source maps to Sentry via @sentry/vite-plugin, which
 * reads SENTRY_AUTH_TOKEN / SENTRY_ORG / the per-app project from process.env at
 * build time. Turbo 2 runs builds in strict env mode, so any var not declared in
 * turbo.json's build.env is filtered out — the plugin would then silently skip,
 * shipping minified stack traces. These must stay declared.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const buildEnv: string[] = (() => {
  const raw = readFileSync(resolve(__dirname, '../../..', 'turbo.json'), 'utf8')
  // turbo.json allows // comments; strip them before JSON.parse.
  const json = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''))
  return json.tasks?.build?.env ?? json.pipeline?.build?.env ?? []
})()

describe('turbo build env — Sentry source-map upload', () => {
  it.each([
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'PWA_SENTRY_PROJECT',
    'PATIENT_SENTRY_PROJECT',
    'VITE_GIT_SHA',
  ])('declares %s so strict env mode does not filter it out', (name) => {
    expect(buildEnv).toContain(name)
  })
})
