/**
 * Tests for scripts/api-contract-audit.mjs (F14). Each test builds a small throwaway repo layout in
 * the OS temp dir (a backend with a few routes, frontends with a few calls) and runs the real script
 * against it as a subprocess, pointing it there with --root and --allowlist.
 *
 *   pnpm run test:contract-audit
 *
 * What they pin: a `${…}` hole in a call matches a route PARAMETER and never a literal route
 * segment (the plan page that called `/api/payment-plans/${id}` was "satisfied" by the literal route
 * `/api/payment-plans/overdue` and got a 404), the patient and reports apps are scanned like the
 * others, and a deferral needs a written reason.
 */

import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'api-contract-audit.mjs')
const madeDirs = []

after(() => {
  for (const dir of madeDirs) rmSync(dir, { recursive: true, force: true })
})

/** The backend of the fixture repo: two routers, mounted the way backend/src/app.ts mounts them. */
const BACKEND = {
  'backend/src/app.ts': `import { Hono } from 'hono'
import { patientsApp } from './routes/patients'
import { plansApp } from './routes/plans'

const app = new Hono()
app.route('/api/payment-plans', plansApp)
app.route('/api/patients', patientsApp)

export { app }
`,
  'backend/src/routes/plans.ts': `import { Hono } from 'hono'

const plansApp = new Hono()
plansApp.get('/overdue', (c) => c.json([]))
plansApp.get('/templates', (c) => c.json([]))
plansApp.patch('/:id/pause', (c) => c.json({}))

export { plansApp }
`,
  'backend/src/routes/patients.ts': `import { Hono } from 'hono'

const patientsApp = new Hono()
patientsApp.get('/:id', (c) => c.json({}))
patientsApp.get('/:id/notes', (c) => c.json([]))
patientsApp.patch('/:id', (c) => c.json({}))

export { patientsApp }
`,
}

/** Build a fixture repo: the backend above plus whatever frontend files the test brings. */
function fixture(frontend = {}, allowlist) {
  const root = mkdtempSync(join(tmpdir(), 'contract-audit-'))
  madeDirs.push(root)
  for (const [rel, text] of Object.entries({ ...BACKEND, ...frontend })) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  const allowlistPath = join(root, 'allowlist.json')
  if (allowlist !== undefined) {
    writeFileSync(allowlistPath, typeof allowlist === 'string' ? allowlist : JSON.stringify(allowlist))
  }
  return { root, allowlistPath }
}

function run(fx, ...extra) {
  const res = spawnSync(
    process.execPath,
    [SCRIPT, `--root=${fx.root}`, `--allowlist=${fx.allowlistPath}`, ...extra],
    { encoding: 'utf8' }
  )
  return { code: res.status, out: res.stdout, err: res.stderr }
}

/** Run with --json and give back the exit code and the parsed report. */
function report(fx, ...extra) {
  const res = run(fx, '--json', ...extra)
  return { code: res.code, ...JSON.parse(res.out) }
}

const keys = (r) => r.findings.map((f) => `${f.app} ${f.method} ${f.path}`).sort()

describe('strict matching: a hole is one parameter, never a literal segment', () => {
  const plansPage = {
    'portals/src/plan.ts': 'api.get(`/api/payment-plans/${id}`)\n',
  }

  it('flags a call whose only possible match is a literal route (the F05 case)', () => {
    const r = report(fixture(plansPage))
    assert.equal(r.code, 1)
    assert.deepEqual(keys(r), ['portal GET /api/payment-plans/*'])
    assert.equal(r.findings[0].category, 'unmatched-path')
  })

  it('--lenient keeps the old behaviour, where the hole matched /overdue and hid the 404', () => {
    const r = report(fixture(plansPage), '--lenient')
    assert.equal(r.code, 0)
    assert.deepEqual(keys(r), [])
  })

  it('lets a hole match a route parameter, at the end and in the middle', () => {
    const r = report(
      fixture({
        'portals/src/patient.ts':
          'api.get(`/api/patients/${id}`)\napi.get(`/api/patients/${id}/notes`)\napi.patch(`/api/patients/${id}`, body)\n',
      })
    )
    assert.equal(r.code, 0, JSON.stringify(r.findings))
    assert.deepEqual(keys(r), [])
  })

  it('still flags a hole followed by a literal the backend does not have', () => {
    const r = report(fixture({ 'portals/src/patient.ts': 'api.get(`/api/patients/${id}/photos`)\n' }))
    assert.equal(r.code, 1)
    assert.deepEqual(keys(r), ['portal GET /api/patients/*/photos'])
  })

  it('treats a glued trailing hole as a query string, not as a segment', () => {
    const r = report(fixture({ 'portals/src/patient.ts': 'api.get(`/api/patients/${id}${query}`)\n' }))
    assert.equal(r.code, 0, JSON.stringify(r.findings))
  })

  it('still reports a verb the backend does not have', () => {
    const r = report(fixture({ 'portals/src/plan.ts': "api.post('/api/payment-plans/overdue')\n" }))
    assert.equal(r.code, 1)
    assert.equal(r.findings[0].category, 'method-mismatch')
    assert.deepEqual(r.findings[0].backendMethods, ['GET'])
  })
})

describe('every frontend app is scanned', () => {
  const bad = (name) => `api.get('/api/missing-${name}')\n`

  for (const [app, file] of [
    ['portal', 'portals/src/a.ts'],
    ['hr', 'hr/src/a.ts'],
    ['team', 'team/src/a.ts'],
    ['patient', 'patient/src/a.ts'],
    ['reports', 'reports/src/a.ts'],
    ['reports', 'reports/components/a.tsx'],
    ['reports', 'reports/hooks/a.ts'],
    ['reports', 'reports/lib/a.ts'],
  ]) {
    it(`reports a broken call in ${file} under "${app}"`, () => {
      const r = report(fixture({ [file]: bad(app) }))
      assert.equal(r.code, 1)
      assert.deepEqual(keys(r), [`${app} GET /api/missing-${app}`])
    })
  }

  it('does not read build output or test files', () => {
    const r = report(
      fixture({
        'patient/src/__tests__/a.ts': bad('test-dir'),
        'patient/src/a.test.ts': bad('test-file'),
        'reports/lib/node_modules/x/a.ts': bad('node-modules'),
        'reports/lib/.next/a.ts': bad('next-output'),
      })
    )
    assert.equal(r.code, 0, JSON.stringify(r.findings))
  })
})

describe('the allowlist', () => {
  const brokenCall = { 'patient/src/a.ts': "api.get('/api/missing')\n" }
  const entry = { app: 'patient', method: 'GET', path: '/api/missing', reason: 'pending the route' }

  it('does not block a finding that is listed with a reason', () => {
    const r = report(fixture(brokenCall, { entries: [entry] }))
    assert.equal(r.code, 0)
    assert.equal(r.findings.length, 1)
    assert.equal(r.findings[0].allow.reason, 'pending the route')
  })

  it('refuses an entry that has no reason', () => {
    const res = run(fixture(brokenCall, { entries: [{ ...entry, reason: '' }] }))
    assert.equal(res.code, 2)
    assert.match(res.err, /missing a "reason"/)
  })

  it('is scoped to the app: the same path from another app is still blocking', () => {
    const r = report(
      fixture(
        { ...brokenCall, 'team/src/a.ts': "api.get('/api/missing')\n" },
        { entries: [entry] }
      )
    )
    assert.equal(r.code, 1)
    assert.deepEqual(
      r.findings.filter((f) => !f.allow).map((f) => f.app),
      ['team']
    )
  })

  it('names an entry that no longer matches anything, so it gets removed', () => {
    const res = run(fixture({}, { entries: [entry] }))
    assert.equal(res.code, 0)
    assert.match(res.out, /Stale allowlist entries/)
  })

  it('--no-allowlist ignores the list', () => {
    const fx = fixture(brokenCall, { entries: [entry] })
    assert.equal(run(fx, '--no-allowlist').code, 1)
  })
})

describe('this repository', () => {
  it('has no blocking finding, with the real allowlist, in strict mode', () => {
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
    assert.equal(res.status, 0, res.stdout)
    assert.match(res.stdout, /Matching:\s+strict/)
  })

  it('scans all five frontends', () => {
    const res = spawnSync(process.execPath, [SCRIPT, '--list-calls'], { encoding: 'utf8' })
    for (const app of ['portal', 'hr', 'team', 'patient', 'reports']) {
      assert.match(res.stdout, new RegExp(`^${app}\\s`, 'm'), `no call site found for ${app}`)
    }
  })
})
