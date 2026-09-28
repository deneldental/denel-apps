/**
 * A scheduled backup records its outcome on the Backup card. There is no user
 * behind a scheduled run, and `clinic_settings.updatedById` references a real
 * user — so the run must record itself as "no user", on a real database.
 * pg_dump and the upload are faked; the settings writes are real.
 *
 *   DATABASE_URL=postgresql://framada:framada@localhost:5499/framada \
 *     npx vitest run tests/integration/backup-status.test.ts
 */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5499/framada',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/storage-router', () => ({
  uploadToCategory: vi.fn(async () => ({
    url: 'private-file://r2/x#0123456789abcdef',
    providerId: 'r2',
  })),
  uploadPrivateToProvider: vi.fn(async () => ({
    url: 'private-file://r2/x#0123456789abcdef',
    providerId: 'r2',
  })),
}))

import { spawn } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { getDb } from '../../src/db'
import { clinicSettings } from '../../src/db/schema'
import { runBackupNow } from '../../src/lib/backup-scheduler'
import { getBackupConfig, INTEGRATION_KEYS, setBackupConfig } from '../../src/lib/integrations'

function fakePgDump() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: () => void
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => {}
  setImmediate(() => {
    child.stdout.end('-- dump\n')
    child.stderr.end()
    setImmediate(() => child.emit('close', 0))
  })
  return child
}

describe.skipIf(!IS_LOCAL)('backup status on a real database', () => {
  let previous: unknown

  beforeAll(async () => {
    const db = getDb(RAW_DB_URL)
    const [row] = await db
      .select({ value: clinicSettings.value })
      .from(clinicSettings)
      .where(eq(clinicSettings.key, INTEGRATION_KEYS.BACKUP))
    previous = row?.value
  })

  afterAll(async () => {
    const db = getDb(RAW_DB_URL)
    await db.delete(clinicSettings).where(eq(clinicSettings.key, INTEGRATION_KEYS.BACKUP))
    if (previous !== undefined) {
      await db.insert(clinicSettings).values({ key: INTEGRATION_KEYS.BACKUP, value: previous })
    }
  })

  it('a scheduled run records "ok" on the Backup card', async () => {
    await setBackupConfig(
      {
        connectionString: 'postgresql://framada:framada@localhost:5433/framada',
        schedule: 'daily-6pm',
        targetProvider: 'r2',
        enabled: true,
      },
      null
    )
    vi.mocked(spawn).mockImplementation(() => fakePgDump() as never)

    const result = await runBackupNow()

    expect(result.status).toBe('ok')
    expect((await getBackupConfig())?.lastStatus).toBe('ok')
  })
})
