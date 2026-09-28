/**
 * settings-domain-audit B4: the products / inventory locks lived only in the
 * process cache, so every deploy (or restart) silently unlocked both and
 * `canPerformAction` let non-admins write again. They must be persisted in
 * `clinic_settings` like the low-stock threshold — DB on write, lazy cache on
 * read — through `getLock` / `setLock` in lib/settings-store.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
}))

import { cache } from '../../src/lib/cache'
import {
  getLock,
  INVENTORY_LOCK_KEY,
  PRODUCTS_LOCK_KEY,
  setLock,
} from '../../src/lib/settings-store'

/** Rows the next select sees, and every upsert the fake received. */
let storedRows: Array<{ value: unknown }> = []
const upserts: Array<Record<string, unknown>> = []
let selects = 0

const fakeDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => {
          selects += 1
          return storedRows
        }),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn((row: Record<string, unknown>) => {
      upserts.push(row)
      return { onConflictDoUpdate: vi.fn(async () => undefined) }
    }),
  })),
} as unknown as Parameters<typeof getLock>[0]

describe('getLock / setLock', () => {
  afterEach(() => {
    storedRows = []
    upserts.length = 0
    selects = 0
    cache.delete(PRODUCTS_LOCK_KEY)
    cache.delete(INVENTORY_LOCK_KEY)
  })

  it('maps each target to its own clinic_settings key', () => {
    expect(PRODUCTS_LOCK_KEY).toBe('settings:products:locked')
    expect(INVENTORY_LOCK_KEY).toBe('settings:inventory:locked')
  })

  it('is unlocked when nothing was ever saved', async () => {
    await expect(getLock(fakeDb, 'products')).resolves.toBe(false)
  })

  it('reads a persisted lock from the database', async () => {
    storedRows = [{ value: true }]
    await expect(getLock(fakeDb, 'inventory')).resolves.toBe(true)
  })

  it('persists a lock and serves later reads from the cache', async () => {
    await expect(setLock(fakeDb, 'products', true, 'u-1')).resolves.toBe(true)
    expect(upserts[0]).toMatchObject({ key: PRODUCTS_LOCK_KEY, value: true, updatedById: 'u-1' })

    storedRows = [] // even with no row visible, the cache answers
    await expect(getLock(fakeDb, 'products')).resolves.toBe(true)
    expect(selects).toBe(0)
  })

  it('keeps the two targets independent', async () => {
    await setLock(fakeDb, 'products', true, 'u-1')
    await expect(getLock(fakeDb, 'inventory')).resolves.toBe(false)
  })

  it('ignores a non-boolean stored value', async () => {
    storedRows = [{ value: 'yes' }]
    await expect(getLock(fakeDb, 'products')).resolves.toBe(false)
  })
})
