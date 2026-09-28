import { describe, expect, it, vi } from 'vitest'

// The report actions import `@/lib/api-client`, which reads `import.meta.env`.
// Mock it so the schemas can be exercised in isolation — we feed `api.get`
// canned responses and assert the action layer rejects malformed payloads
// (H25) instead of letting `NaN` currency reach the UI.
const get = vi.fn()
vi.mock('@/lib/api-client', () => ({
  api: { get: (...args: unknown[]) => get(...args) },
}))

import { z } from 'zod'
import { getBalanceSheet, getProfitLoss } from './financial-reports'
import { getCashFlow } from './phase8-reports'
import { parseReport } from './report-schema'

describe('H25 — report responses are runtime-validated', () => {
  it('rejects a malformed profit-loss payload (string where amount expected) instead of producing NaN', async () => {
    get.mockResolvedValueOnce({
      success: true,
      data: {
        from: '2026-01-01',
        to: '2026-01-31',
        revenue: [],
        // a non-numeric, non-coercible amount — would have rendered "GHS NaN"
        totalRevenue: 'not-a-number',
        expenses: [],
        totalExpenses: 0,
        netIncome: 0,
      },
    })

    const res = await getProfitLoss('2026-01-01', '2026-01-31')
    expect(res.success).toBe(false)
    expect(res.data).toBeUndefined()
    expect(res.error).toMatch(/malformed report data/i)
  })

  it('rejects a balance-sheet payload missing required fields', async () => {
    get.mockResolvedValueOnce({
      success: true,
      data: { asOf: '2026-01-31', assets: [] }, // everything else missing
    })

    const res = await getBalanceSheet('2026-01-31')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/malformed report data/i)
  })

  it('rejects a null nested amount in a cash-flow line', async () => {
    get.mockResolvedValueOnce({
      success: true,
      data: {
        from: '2026-01-01',
        to: '2026-01-31',
        operating: [{ sourceDocType: 'payment', net: null }],
        investing: [],
        financing: [],
        totals: { operating: 0, investing: 0, financing: 0 },
        netChange: 0,
        openingCash: 0,
        closingCash: 0,
      },
    })

    const res = await getCashFlow('2026-01-01', '2026-01-31')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/malformed report data/i)
  })

  it('coerces a numeric string amount into a real number on a valid payload', async () => {
    get.mockResolvedValueOnce({
      success: true,
      data: {
        from: '2026-01-01',
        to: '2026-01-31',
        revenue: [{ accountId: 'a1', accountCode: '4100', accountName: 'Fees', amount: '1234.50' }],
        totalRevenue: '1234.50',
        expenses: [],
        totalExpenses: 0,
        netIncome: '1234.50',
      },
    })

    const res = await getProfitLoss('2026-01-01', '2026-01-31')
    expect(res.success).toBe(true)
    expect(res.data?.totalRevenue).toBe(1234.5)
    expect(res.data?.revenue[0]?.amount).toBe(1234.5)
    // Crucially: never NaN.
    expect(Number.isNaN(res.data?.totalRevenue)).toBe(false)
  })

  it('passes a transport failure through untouched', () => {
    const schema = z.object({ x: z.number() })
    const res = parseReport(schema, { success: false, error: 'Network error' })
    expect(res.success).toBe(false)
    expect(res.error).toBe('Network error')
  })
})
