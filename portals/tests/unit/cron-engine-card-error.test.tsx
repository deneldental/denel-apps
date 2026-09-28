/**
 * Integrations → Cron engine → Registered jobs. A failed run's message can be
 * enormous (a failed query including its parameters). Shown whole, that one
 * unbroken string stretched the table past the screen and pushed the Run
 * buttons out of view — the page must show only a short preview.
 */
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { CronEngineConfigCard } from '@/features/integrations/components/cron-engine-config-card'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const LONG_ERROR = `Failed query: insert into "clinic_settings" ${'A'.repeat(900)}`

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({
    success: true,
    data: {
      config: { nodeCronEnabled: true, qstashEnabled: false, internalSecretMasked: '••••1234' },
      jobs: [
        {
          id: 'backup-daily',
          description: 'Daily database backup.',
          cron: '0 18 * * *',
          lastRun: {
            startedAt: '2026-09-26T22:01:37.864Z',
            source: 'manual',
            status: 'failed',
            errorMessage: LONG_ERROR,
          },
          nextRuns: [],
        },
      ],
    },
  })
})
afterEach(() => vi.clearAllMocks())

describe('Registered jobs with a huge failure message', () => {
  it('shows a short preview of the error, never the whole message', async () => {
    renderWithRouter(<CronEngineConfigCard />)

    const preview = await screen.findByText(/^Failed query:/)
    expect(preview.textContent?.length ?? 0).toBeLessThanOrEqual(240)
    expect(preview.textContent?.endsWith('…')).toBe(true)
    expect(screen.queryByText(LONG_ERROR)).not.toBeInTheDocument()
  })

  it('still offers the Run button on that row', async () => {
    renderWithRouter(<CronEngineConfigCard />)

    expect(await screen.findByRole('button', { name: /run/i })).toBeInTheDocument()
  })
})
