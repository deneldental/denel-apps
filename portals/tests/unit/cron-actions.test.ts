/**
 * "Run now" waits for the job to finish. A database backup takes longer than
 * the client's default 30-second timeout, which used to report a failure while
 * the backup kept running — inviting a second click and a second backup.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))

import { runCronJobNow } from '@/lib/actions/integrations'
import { api } from '@/lib/api-client'

describe('runCronJobNow', () => {
  afterEach(() => vi.clearAllMocks())

  it('waits up to five minutes for the job to finish', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true })

    await runCronJobNow('backup-daily')

    const [path, , options] = vi.mocked(api.post).mock.calls[0]
    expect(path).toBe('/api/integrations/cron-engine/run/backup-daily')
    expect(options).toMatchObject({ timeout: 5 * 60 * 1000 })
  })
})
