/**
 * Tests for .github/workflows/deploy.yml (G11, F13). Run with:
 *
 *   pnpm run test:deploy-workflow
 *
 * Production deploys by hand only: a push to `main` runs the quality gates and stops; the
 * "Run workflow" button on `main` is the one way to production. Staging still deploys on every push to
 * `staging`. A mistake in a condition here is invisible until the day it matters (a deploy that did
 * not run, or one that ran on a push nobody meant to ship), so the shape of the workflow is pinned.
 *
 * The workflow is read as text, job by job: no YAML parser is needed for conditions this plain, and
 * it keeps the test free of dependencies.
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const WORKFLOW = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'deploy.yml')
const text = readFileSync(WORKFLOW, 'utf8')

/** The text of one top-level job (from its `  name:` line to the next job). */
function job(name) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l === `  ${name}:`)
  assert.ok(start >= 0, `no job called "${name}" in deploy.yml`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:$/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/** The `if:` of a job, as written. */
function condition(name) {
  const m = job(name).match(/^ {4}if: (.+)$/m)
  assert.ok(m, `job "${name}" has no if:`)
  return m[1]
}

const onlyOnPushToStaging = "github.event_name == 'push' && github.ref_name == 'staging'"
const onlyOnManualRunOnMain = "github.event_name == 'workflow_dispatch' && github.ref_name == 'main'"

describe('how the workflow is started', () => {
  const on = text.slice(text.indexOf('\non:'), text.indexOf('\nconcurrency:'))

  it('runs on pushes to main and staging, on pull requests, and by hand', () => {
    assert.match(on, /push:\n\s+branches: \[main, staging\]/)
    assert.match(on, /pull_request:\n\s+branches: \[main, staging, dev\]/)
    assert.match(on, /^ {2}workflow_dispatch:$/m)
  })

  it('never cancels a manual run, and keeps manual and automatic runs in separate groups', () => {
    assert.match(
      text,
      /concurrency:\n {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}-\$\{\{ github\.event_name == 'workflow_dispatch' && 'manual' \|\| 'auto' \}\}\n {2}cancel-in-progress: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}/
    )
  })
})

describe('production', () => {
  it('the backend reaches production only from a manual run on main', () => {
    assert.equal(condition('deploy-backend-production'), onlyOnManualRunOnMain)
  })

  it('the backend deploy still waits for the quality gates and the schema-drift check', () => {
    assert.match(job('deploy-backend-production'), /^ {4}needs: \[check, schema-drift, changes\]$/m)
  })

  it('the frontends and the website go out on a push to staging, or a manual run on main — nothing else', () => {
    const expected = (what) =>
      `((${onlyOnPushToStaging}) || (${onlyOnManualRunOnMain})) && ${what}`
    assert.equal(
      condition('deploy-frontends'),
      expected("needs.changes.outputs.frontend_matrix != '{\"include\":[]}'")
    )
    assert.equal(condition('deploy-website'), expected("needs.changes.outputs.website == 'true'"))
  })

  it('no job deploys because of a push to main', () => {
    for (const name of ['deploy-backend-production', 'deploy-frontends', 'deploy-website']) {
      assert.doesNotMatch(
        condition(name),
        /github\.event_name == 'push' && github\.ref_name == 'main'/,
        `${name} must not run on a push to main`
      )
      assert.doesNotMatch(condition(name), /github\.event_name == 'push'(?! && github\.ref_name == 'staging')/)
    }
  })
})

describe('staging stays automatic', () => {
  for (const name of ['deploy-backend-staging', 'migrate-staging']) {
    it(`${name} runs on a push to staging that changed the backend`, () => {
      assert.equal(
        condition(name),
        `${onlyOnPushToStaging} && needs.changes.outputs.backend == 'true'`
      )
    })
  }

  it('the post-deploy smoke tests run for staging pushes only', () => {
    for (const name of ['e2e-smoke', 'e2e-smoke-pwa', 'e2e-smoke-reports']) {
      assert.match(condition(name), /github\.event_name == 'push' && github\.ref_name == 'staging'$/)
    }
  })
})

describe('a manual run has no diff, so it builds everything', () => {
  const changes = job('changes')

  it('reports the backend and the website as changed', () => {
    assert.match(changes, /website: \$\{\{ github\.event_name == 'workflow_dispatch' && 'true' \|\| steps\.filter\.outputs\.website \}\}/)
    assert.match(changes, /backend: \$\{\{ github\.event_name == 'workflow_dispatch' && 'true' \|\| steps\.filter\.outputs\.backend \}\}/)
  })

  it('does not ask the path filter (there is nothing to compare against)', () => {
    assert.match(changes, /id: filter\n {8}if: github\.event_name != 'workflow_dispatch'/)
  })

  it('puts every frontend in the build matrix', () => {
    assert.match(changes, /ALL: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/)
    for (const app of ['portal', 'team', 'patient', 'reports', 'hr']) {
      assert.match(changes, new RegExp(`\\[\\[ "\\$ALL" == 'true' \\|\\| "\\$\\{\\{ steps\\.filter\\.outputs\\.${app} \\}\\}" == 'true' \\]\\] && apps\\+=`))
    }
  })
})

describe('the checks a manual deploy must not skip', () => {
  const check = job('check')

  it('keeps the lint ratchet, the contract audit and its self-test as hard gates', () => {
    for (const step of [
      'Lint ratchet (no new warnings)',
      'API contract audit — self-test',
      'API contract audit (backend ↔ frontend)',
      'Deploy workflow — self-test',
    ]) {
      assert.ok(check.includes(`- name: ${step}`), `the quality gates lost the step "${step}"`)
    }
    assert.doesNotMatch(check, /continue-on-error: true/)
    assert.doesNotMatch(job('schema-drift'), /continue-on-error: true/)
  })

  it('does not condition the gates on how the run was started', () => {
    assert.doesNotMatch(check, /^ {4}if:/m)
    assert.doesNotMatch(job('schema-drift'), /^ {4}if:/m)
  })
})

describe('the production environment file', () => {
  const production = job('deploy-backend-production')

  it('refuses to restart the container without the keys the backend needs to start', () => {
    const m = production.match(/for required in ([A-Z_ ]+); do/)
    assert.ok(m, 'the required-key loop is gone')
    const keys = m[1].trim().split(/\s+/)
    for (const key of [
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'ALLOWED_ORIGINS',
      'PRIVATE_FILE_REF_SECRET',
      'PORTAL_URL', // F13
      'PATIENT_PORTAL_URL', // F13
    ]) {
      assert.ok(keys.includes(key), `${key} is no longer required before the container restarts`)
    }
  })

  it('removes the rendered file from the runner whatever happens', () => {
    assert.match(production, /- name: Remove rendered env file from runner\n {8}if: always\(\)/)
  })
})
