import { Hono } from 'hono'
import puppeteer, { type Browser, type CookieData } from 'puppeteer'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { portalUrl } from '../lib/public-urls'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const analyticsExportApp = new Hono<HonoEnv>()

/**
 * Render the SPA's /analytics/print route into a PDF using headless Chromium
 * and stream the result back. Forwards the caller's cookies into the browser
 * session so the page's authenticated API calls succeed.
 *
 * Query params (all forwarded to the print URL untouched, then re-read by the
 * AnalyticsPeriodProvider on the client):
 *   granularity = monthly | quarterly | yearly
 *   from        = ISO timestamp (inclusive)
 *   to          = ISO timestamp (exclusive)
 *   label       = human-readable period label
 *   year, month, quarter — restored by the provider when constructing the period
 */
analyticsExportApp.get('/export-pdf', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  // This route was authenticated but never authorised — any signed-in user of
  // any role could pull the export. Every neighbouring analytics route gates on
  // analytics:read.
  if (!(await checkPermission(c, user.id, MODULES.ANALYTICS, ACTIONS.READ))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  // The print view is a page of the clinic portal. A deployed backend always has PORTAL_URL (it
  // refuses to start without it); the check stays so a misconfigured one answers plainly.
  let portalBase: string
  try {
    portalBase = portalUrl()
  } catch {
    return c.json(
      { error: 'PDF export not configured — PORTAL_URL is not set on the backend.' },
      500
    )
  }

  const incomingCookie = c.req.header('cookie') ?? ''
  if (!incomingCookie) {
    return c.json({ error: 'Missing session cookie — cannot render print view.' }, 400)
  }

  const url = new URL('/analytics/print', portalBase)
  // Carry the period control params through to the print page so it can
  // restore the same window the user picked.
  for (const key of ['granularity', 'from', 'to', 'label', 'year', 'month', 'quarter']) {
    const v = c.req.query(key)
    if (v) url.searchParams.set(key, v)
  }

  const label = c.req.query('label') ?? 'Period'
  await logAnalyticsAccess(c, 'export-pdf', `period=${label}`)

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
    await page.setViewport({ width: 1280, height: 1800 })

    // Forward the user's session + CSRF cookies so the SPA's authenticated
    // API calls succeed. Bind each cookie to both origins — the API origin so
    // the cross-fetch carries the session, and the portal origin so the SPA
    // can read csrf from document.cookie before sending it as a header.
    const cookies = parseCookieHeader(incomingCookie, [portalBase, process.env.BETTER_AUTH_URL])
    if (cookies.length > 0) {
      await browser.setCookie(...cookies)
    }

    await page.goto(url.toString(), { waitUntil: 'networkidle2', timeout: 60_000 })
    // Recharts animations + lazy chart sizing settle within ~1s of networkidle.
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    })

    const filename = `Analytics-${label.replace(/\s+/g, '-')}.pdf`
    c.header('Content-Type', 'application/pdf')
    c.header('Content-Disposition', `attachment; filename="${filename}"`)
    c.header('Cache-Control', 'no-store')
    return c.body(pdf as unknown as ArrayBuffer)
  } catch (error: unknown) {
    logError(error, { context: '[analytics/export-pdf]' })
    return c.json({ error: 'PDF export failed' }, 500)
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch {
        // ignore close errors — the orphan will be reaped on next launch
      }
    }
  }
})

/**
 * Split a raw `Cookie:` header into Puppeteer cookie descriptors. We bind each
 * cookie to every domain the SPA + backend live on so the browser carries
 * them through both the page navigation and the page's API calls.
 */
function parseCookieHeader(header: string, origins: Array<string | undefined>): CookieData[] {
  const targets: Array<{ origin: string; domain: string; secure: boolean }> = []
  for (const origin of origins) {
    if (!origin) continue
    try {
      const u = new URL(origin)
      targets.push({ origin, domain: u.hostname, secure: u.protocol === 'https:' })
    } catch {}
  }
  if (targets.length === 0) return []

  const pairs = header
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
  const out: CookieData[] = []
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (!name) continue
    for (const target of targets) {
      out.push({
        name,
        value,
        domain: target.domain,
        path: '/',
        secure: target.secure,
        sameSite: 'Lax',
      })
    }
  }
  return out
}

export default analyticsExportApp
