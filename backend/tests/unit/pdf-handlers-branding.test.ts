/**
 * settings-domain-audit B3: the payslip PDF read its branding from the
 * `clinic_settings` key `'clinic_branding'`, which nothing writes — the real
 * key is `integration_branding`, behind `lib/branding.getBranding()` — so
 * every payslip rendered with the built-in fallbacks. The handler must take
 * the clinic's configured branding.
 *
 * The DB, the branding accessor, the HTML template and the PDF renderer are
 * mocked; the assertion is on what reaches the template.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
}))

const slip = {
  id: 'slip-1',
  staffId: 'staff-1',
  status: 'published',
  payPeriod: '2026-08-01',
  grossPay: 500000,
  netPay: 420000,
  deductions: {},
  publishedAt: '2026-09-01T00:00:00.000Z',
}
const staffUser = { id: 'staff-1', fullName: 'Ama Asante', staffId: 'S-001' }

vi.mock('../../src/db', async () => {
  const schema = await import('../../src/db/schema')
  return {
    getDb: vi.fn(() => ({
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          const rows =
            table === schema.payslips ? [slip] : table === schema.staff ? [staffUser] : []
          return { where: vi.fn(async () => rows) }
        }),
      })),
    })),
  }
})

vi.mock('../../src/lib/branding', () => ({
  getBranding: vi.fn(async () => ({
    name: 'Denel Dental Clinic',
    logoUrl: 'https://cdn.example/denel-logo.png',
    logoIconUrl: null,
    phones: ['+233 20 000 0000'],
    email: 'clinic@denel.example',
  })),
}))
vi.mock('../../src/lib/pdf-render', () => ({
  renderHtmlToPdf: vi.fn(async () => Buffer.from('%PDF')),
}))
vi.mock('../../src/lib/payroll-run-html', () => ({
  generatePayslipHtml: vi.fn(() => '<html />'),
  generatePayrollRunHtml: vi.fn(() => '<html />'),
}))

import { generatePayslipHtml } from '../../src/lib/payroll-run-html'
import { handleGetSinglePayslipPdf } from '../../src/lib/pdf-handlers'

const mockGeneratePayslipHtml = vi.mocked(generatePayslipHtml)

describe('handleGetSinglePayslipPdf', () => {
  it("renders the payslip with the clinic's configured branding, not the fallbacks", async () => {
    const c = { text: vi.fn() } as unknown as Parameters<typeof handleGetSinglePayslipPdf>[0]
    const res = await handleGetSinglePayslipPdf(c, 'slip-1')
    expect(res).toBeInstanceOf(Response)

    expect(mockGeneratePayslipHtml).toHaveBeenCalledTimes(1)
    const docData = mockGeneratePayslipHtml.mock.calls[0]?.[0] as {
      clinic: { name: string; logoUrl: string; phone: string | null; email: string | null }
    }
    expect(docData.clinic).toMatchObject({
      name: 'Denel Dental Clinic',
      logoUrl: 'https://cdn.example/denel-logo.png',
      phone: '+233 20 000 0000',
      email: 'clinic@denel.example',
    })
  })
})
