/**
 * pdf-render.ts — render a self-contained HTML string to a PDF buffer via
 * headless Chromium (Puppeteer). Server-side, no network: the caller supplies
 * fully-inlined HTML/CSS (no external assets), we set it as the page content and
 * print to PDF.
 *
 * Use for document-style PDFs (patient statements, receipts) where an HTML/CSS
 * template is far easier to maintain than hand-drawn pdf-lib coordinates. Same
 * Chromium the analytics export already ships, so no new dependency.
 */

import puppeteer, { type Browser, type PDFOptions } from 'puppeteer'

export interface RenderHtmlToPdfOptions {
  /** Print margins. Defaults to a document-friendly ~14/12mm. */
  margin?: PDFOptions['margin']
  /** Page format. Defaults to A4. */
  format?: PDFOptions['format']
  /** Optional header/footer templates (Puppeteer print HTML). */
  headerTemplate?: string
  footerTemplate?: string
  displayHeaderFooter?: boolean
}

export async function renderHtmlToPdf(
  html: string,
  options: RenderHtmlToPdfOptions = {}
): Promise<Buffer> {
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    })
    const page = await browser.newPage()
    // The HTML is self-contained, so `load` is enough — no network to idle on.
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 })
    const pdf = await page.pdf({
      format: options.format ?? 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: options.displayHeaderFooter ?? false,
      headerTemplate: options.headerTemplate,
      footerTemplate: options.footerTemplate,
      margin: options.margin ?? { top: '14mm', right: '12mm', bottom: '16mm', left: '12mm' },
    })
    return Buffer.from(pdf)
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch {
        // ignore close errors — the orphan is reaped on next launch
      }
    }
  }
}
