/**
 * settings-domain-audit B8: the Module Visibility section listed a `training`
 * toggle long after the Training module moved to the HR app, so admins could
 * flip a switch that controlled nothing. Every toggle must target a module
 * that is actually registered in `src/app/modules/`.
 *
 * The registry is read from source rather than imported: importing it pulls
 * in every page in the app, and a static scan is exactly as authoritative for
 * "which ids exist".
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOGGLABLE_MODULES } from '@/features/settings/components/module-visibility-section'

const MODULES_DIR = resolve(__dirname, '../../src/app/modules')

function registeredModuleIds(): Set<string> {
  const ids = new Set<string>()
  for (const file of readdirSync(MODULES_DIR)) {
    if (!file.endsWith('.tsx')) continue
    const m = readFileSync(join(MODULES_DIR, file), 'utf-8').match(/^\s*id: '([^']+)',?$/m)
    if (m) ids.add(m[1])
  }
  return ids
}

describe('module visibility toggles', () => {
  it('every toggle targets a module registered in src/app/modules', () => {
    const registered = registeredModuleIds()
    expect(registered.size).toBeGreaterThan(10)
    const orphans = TOGGLABLE_MODULES.map((m) => m.id).filter((id) => !registered.has(id))
    expect(orphans).toEqual([])
  })

  it('does not list the Training module, which lives in the HR app now', () => {
    expect(TOGGLABLE_MODULES.some((m) => m.id === 'training')).toBe(false)
  })
})
