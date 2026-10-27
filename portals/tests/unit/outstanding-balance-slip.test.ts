/**
 * G05 — the outstanding-balance slip: a printout of what a patient owes, separate from the payment
 * receipt. See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G05) and step-10-handover.md.
 *
 * `printOutstandingBalanceSlip` writes an HTML document into a window. It is handed a stand-in
 * window here, and the document it wrote is read back as text. Which balances go on the slip is
 * decided by the Receive Payment dialog (`receive-payment-dialog.test.tsx`); this file holds the
 * slip to printing exactly what it is given, as text, and to being a different paper from the receipt.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/branding', () => ({
  getBranding: vi.fn(async () => ({
    success: true,
    data: {
      name: 'Denel Dental Clinic',
      phones: ['0302 000 000'],
      address: '12 Oxford St, Accra',
      website: 'https://deneldental.com/',
    },
  })),
}))

import { openReceiptWindow, printOutstandingBalanceSlip } from '@/shared/utils/receipt'

type SlipParams = Parameters<typeof printOutstandingBalanceSlip>[0]

/** A stand-in for the window the slip is written into. */
function standIn() {
  let html = ''
  const win = {
    document: { open: vi.fn(), write: (s: string) => (html += s), close: vi.fn() },
  } as unknown as Window
  return { win, html: () => html }
}

const params: SlipParams = {
  patientName: 'Ama Mensah',
  invoices: [
    { invoiceNumber: 'INV-A', dueDate: '2026-10-01', balanceBefore: 50000 },
    { invoiceNumber: 'INV-B', dueDate: null, balanceBefore: 125050 },
  ],
  paidNow: 20000,
  balanceDue: 155050,
}

/** Print `over` on top of the usual slip into a stand-in window and return the document written. */
async function printed(over: Partial<SlipParams> = {}): Promise<string> {
  const w = standIn()
  await printOutstandingBalanceSlip({ ...params, existingWindow: w.win, autoPrint: false, ...over })
  return w.html()
}

afterEach(() => vi.restoreAllMocks())

describe('what the slip says', () => {
  it('lists every invoice with its due date and the balance it had before the payment', async () => {
    const html = await printed()

    expect(html).toContain('INV-A')
    expect(html).toContain('01 Oct 2026')
    expect(html).toContain('GHS 500.00')
    expect(html).toContain('INV-B')
    expect(html).toContain('No due date')
    expect(html).toContain('GHS 1,250.50')
  })

  it('says how much was paid now and how much is still owed', async () => {
    const html = await printed()

    expect(html).toContain('Paid now')
    expect(html).toContain('GHS 200.00')
    expect(html).toContain('Balance due')
    expect(html).toContain('GHS 1,550.50')
    // The balances listed are the ones from before this payment, and the slip says so.
    expect(html).toContain('before today')
  })

  it('prints a due date that arrives as a timestamp as the same calendar day', async () => {
    const html = await printed({
      invoices: [
        { invoiceNumber: 'INV-T', dueDate: '2026-10-01T00:00:00.000Z', balanceBefore: 100 },
      ],
    })

    expect(html).toContain('01 Oct 2026')
    expect(html).not.toContain('T00:00')
  })

  it('prints the balance due it was given: it does not work it out from the rows listed', async () => {
    // The rows may be only a part of what the patient owes; the server's total is the figure.
    const html = await printed({ balanceDue: 999900 })

    expect(html).toContain('GHS 9,999.00')
    expect(html).not.toContain('GHS 1,550.50')
  })

  it('says so when there is nothing outstanding', async () => {
    const html = await printed({ invoices: [], paidNow: 0, balanceDue: 0 })

    expect(html).toContain('No outstanding invoices')
    expect(html).toContain('GHS 0.00')
    // No payment was made now, so there is no "before today's payment" to speak of.
    expect(html).not.toContain('before today')
  })

  it('is a balance slip with the clinic’s details, not a payment receipt', async () => {
    const html = await printed()

    expect(html).toContain('Outstanding Balance')
    expect(html).not.toContain('Payment Receipt')
    expect(html).toContain('Ama Mensah')
    expect(html).toContain('Denel Dental Clinic')
    expect(html).toContain('0302 000 000')
    expect(html).toContain('12 Oxford St, Accra')
    // The website is shown without its protocol and trailing slash.
    expect(html).toContain('>deneldental.com</div>')
  })
})

describe('the window it is printed into', () => {
  it('uses the window it is given and opens no other', async () => {
    const open = vi.spyOn(window, 'open')
    const w = standIn()
    await printOutstandingBalanceSlip({ ...params, existingWindow: w.win, autoPrint: false })

    expect(open).not.toHaveBeenCalled()
    expect(w.html()).toContain('INV-A')
  })

  it('opens one when it is given none', async () => {
    const w = standIn()
    const open = vi.spyOn(window, 'open').mockReturnValue(w.win)
    await printOutstandingBalanceSlip({ ...params, autoPrint: false })

    expect(open).toHaveBeenCalledTimes(1)
    expect(w.html()).toContain('INV-A')
  })

  it('writes nothing, and does not fail, when the browser would not give it a window', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)

    await expect(
      printOutstandingBalanceSlip({ ...params, autoPrint: false })
    ).resolves.toBeUndefined()
  })

  it('is opened with a placeholder that names the paper being prepared', () => {
    const slip = standIn()
    vi.spyOn(window, 'open').mockReturnValue(slip.win)
    openReceiptWindow('balance slip')
    expect(slip.html()).toContain('Preparing balance slip…')

    const receipt = standIn()
    vi.spyOn(window, 'open').mockReturnValue(receipt.win)
    openReceiptWindow()
    expect(receipt.html()).toContain('Preparing receipt…')
  })

  it('asks the browser to print by default, and only then', async () => {
    const w = standIn()
    await printOutstandingBalanceSlip({ ...params, existingWindow: w.win })
    expect(w.html()).toContain('window.print()')

    expect(await printed({ autoPrint: false })).not.toContain('window.print()')
  })
})

describe('text people typed', () => {
  const hostile = '<img src=x onerror=alert(1)>'

  it('is printed as text, never as markup', async () => {
    const html = await printed({
      patientName: hostile,
      invoices: [{ invoiceNumber: hostile, dueDate: hostile, balanceBefore: 100 }],
    })

    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('is printed as text for the clinic’s own details too', async () => {
    vi.resetModules()
    vi.doMock('@/lib/actions/branding', () => ({
      getBranding: async () => ({
        success: true,
        data: { name: hostile, phones: [hostile], address: hostile, website: hostile },
      }),
    }))
    const fresh = await import('@/shared/utils/receipt')
    const w = standIn()
    await fresh.printOutstandingBalanceSlip({ ...params, existingWindow: w.win, autoPrint: false })

    expect(w.html()).not.toContain('<img src=x')
    expect(w.html()).toContain('&lt;img src=x onerror=alert(1)&gt;')
    vi.doUnmock('@/lib/actions/branding')
  })
})

describe('when the clinic’s details cannot be loaded', () => {
  it('still prints the slip, under the clinic’s default name', async () => {
    vi.resetModules()
    vi.doMock('@/lib/actions/branding', () => ({
      getBranding: async () => {
        throw new Error('down')
      },
    }))
    const fresh = await import('@/shared/utils/receipt')
    const w = standIn()
    await fresh.printOutstandingBalanceSlip({ ...params, existingWindow: w.win, autoPrint: false })

    expect(w.html()).toContain('Denel Dental Clinic')
    expect(w.html()).toContain('INV-A')
    vi.doUnmock('@/lib/actions/branding')
  })
})
