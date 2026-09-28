/**
 * settings-domain-audit S5: `security:audit_retention` was saved by Settings →
 * Security & Kiosk and read by nothing — the monthly job purged `audit_logs`
 * at a hardcoded 365 days. The job now asks the settings store for the
 * configured period and never touches `audit_logs` when it is "indefinite".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobContext } from '../../src/lib/cron/types'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
}))

const deletedTables: unknown[] = []
const fakeDb = {
  delete: vi.fn((table: unknown) => {
    deletedTables.push(table)
    return {
      where: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'row-1' }, { id: 'row-2' }]),
      })),
    }
  }),
}
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => fakeDb) }))
vi.mock('../../src/lib/settings-store', () => ({ getAuditRetentionDays: vi.fn() }))

import { auditLogs, loginAttempts } from '../../src/db/schema/operations'
import { runAuditRetention } from '../../src/lib/cron/jobs/audit-retention'
import { getAuditRetentionDays } from '../../src/lib/settings-store'

const mockRetention = vi.mocked(getAuditRetentionDays)
const ctx = {
  jobId: 'audit-retention-monthly',
  firedAt: new Date(),
  source: 'manual',
} as unknown as JobContext

describe('runAuditRetention', () => {
  afterEach(() => {
    deletedTables.length = 0
    vi.clearAllMocks()
  })

  it('purges audit_logs with the period configured in settings', async () => {
    mockRetention.mockResolvedValue(90)
    const result = await runAuditRetention(ctx)

    expect(deletedTables).toEqual([auditLogs, loginAttempts])
    expect(result.details).toMatchObject({
      auditLogRetentionDays: 90,
      auditLogsDeleted: 2,
      loginAttemptsDeleted: 2,
      loginAttemptRetentionDays: 30,
    })
  })

  it('never touches audit_logs when retention is indefinite', async () => {
    mockRetention.mockResolvedValue(null)
    const result = await runAuditRetention(ctx)

    expect(deletedTables).toEqual([loginAttempts])
    expect(result.details).toMatchObject({ auditLogRetentionDays: null, auditLogsDeleted: 0 })
    expect(result.summary).toMatch(/indefinite/)
  })
})
