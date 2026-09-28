import * as Sentry from '@sentry/node'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getAuth } from './auth'
import { auditMiddleware } from './lib/audit'
import { recordAuthEvent } from './lib/auth-events'
import { readAuthIdentifier } from './lib/auth-identifier'
import { bodyLimitFor } from './lib/body-limit'
import { csrfMiddleware, ensureCsrfCookie } from './lib/csrf'
import { describeDbFlavor } from './lib/db-flavor'
import { logError } from './lib/logger'
import { checkIdentifierThrottle, recordFailure, recordSuccess } from './lib/login-limiter'
import { privateFileLinks } from './lib/private-file-links'
import { clientIp } from './lib/rate-limiter'
import { getCurrentUser } from './lib/rbac'
import type { HonoEnv } from './lib/types'
import { blockTeamAppFromStaffAdmin } from './rbac/middleware/blockTeamAppFromStaffAdmin'
import { detectInterface, resolveAppScope } from './rbac/middleware/detectInterface'
import { enforceInterfaceScope } from './rbac/middleware/enforceInterfaceScope'
import { accessManagementApp } from './routes/access-management'
import { accountsApp } from './routes/accounts'
import { activitiesApp } from './routes/activities'
import { agingReportApp } from './routes/aging-report'
import { analyticsApp } from './routes/analytics'
import analyticsClinicalExtendedApp from './routes/analytics-clinical-extended'
import analyticsCrmApp from './routes/analytics-crm'
import analyticsDataIntegrityApp from './routes/analytics-data-integrity'
import analyticsExportApp from './routes/analytics-export'
import analyticsInsuranceApp from './routes/analytics-insurance'
import analyticsSpecialistExtendedApp from './routes/analytics-specialist-extended'
import analyticsStoreApp from './routes/analytics-store'
import analyticsWorkforceExtendedApp from './routes/analytics-workforce-extended'
// Routes
import { apiKeysApp } from './routes/api-keys'
import { appPaymentMethodsApp, paymentConfirmationsApp } from './routes/app-payments'
import { appointmentTypeRemindersApp } from './routes/appointment-type-reminders'
import { appointmentWorkflowApp } from './routes/appointment-workflow'
import { appointmentsApp } from './routes/appointments'
import { auditLogsApp } from './routes/audit-logs'
import { authApp, CUSTOM_AUTH_PATHS } from './routes/auth'
import { billsApp } from './routes/bills'
import { breakfastApp } from './routes/breakfast'
import { clinicLedgerApp } from './routes/clinic-ledger'
import { complianceApp } from './routes/compliance'
import { complianceCategoriesApp } from './routes/compliance-categories'
import { consentFormsApp } from './routes/consent-forms'
import { consentTemplatesApp } from './routes/consent-templates'
import { creditNotesApp } from './routes/credit-notes'
import { crmApp } from './routes/crm'
import { dashboardApp } from './routes/dashboard'
import { databaseApp } from './routes/database'
import { deferredRevenueApp } from './routes/deferred-revenue'
import { diagApp } from './routes/diag'
import { doctorsApp } from './routes/doctors'
import { documentTagsApp } from './routes/document-tags'
import { documentsApp } from './routes/documents'
import { emailApp } from './routes/email'
import { expensesApp } from './routes/expenses'
import { financeHealthApp } from './routes/finance-health'
import { financialAnalyticsApp } from './routes/financial-analytics'
import { financialsApp } from './routes/financials'
import { fixedAssetsApp } from './routes/fixed-assets'
import { googleCalendarApp } from './routes/google-calendar'
import { googleContactsApp } from './routes/google-contacts'
import { hrPhase2 } from './routes/hr-phase2'
import { hrPhase34 } from './routes/hr-phase3-4'
import { icd10CodesApp } from './routes/icd10-codes'
import { insuranceApp } from './routes/insurance'
import { insuranceClaimsApp } from './routes/insurance-claims'
import { insurancePricingApp } from './routes/insurance-pricing'
import { integrationsApp } from './routes/integrations'
import { internalCron } from './routes/internal-cron'
import { inventoryApp } from './routes/inventory'
import { inventoryLocationsApp } from './routes/inventory-locations'
import { invoicesApp } from './routes/invoices'
import { itemsApp } from './routes/items'
import { journalEntriesApp } from './routes/journal-entries'
import { kioskApp } from './routes/kiosk'
import { labsApp } from './routes/labs'
import { ledgerAdjustmentsApp } from './routes/ledger-adjustments'
import { lookupsApp } from './routes/lookups'
import { medicalRecordsApp } from './routes/medical-records'
import { messagesApp } from './routes/messages'
import { odontogramApp } from './routes/odontogram'
import { openapiApp } from './routes/openapi'
import { orthoConsentApp } from './routes/ortho-consent'
import { patientAuthApp } from './routes/patient-auth'
import { patientCasesApp } from './routes/patient-cases'
import { patientMediaApp } from './routes/patient-media'
import { patientPortalApp } from './routes/patient-portal'
import { patientRemindersApp } from './routes/patient-reminders'
import { patientStatementsApp } from './routes/patient-statements'
import { patientTagsApp } from './routes/patient-tags'
import { patientTimelineApp } from './routes/patient-timeline'
import { patientsApp } from './routes/patients'
import { paymentPlansApp } from './routes/payment-plans'
import { paymentsApp } from './routes/payments'
import { payrollApp } from './routes/payroll'
import { perioApp } from './routes/perio-chart'
import { periodsApp } from './routes/periods'
import { pettyCashApp } from './routes/petty-cash'
import { productsApp } from './routes/products'
import { pushApp } from './routes/push'
import { recareApp } from './routes/recare'
import { reminderTemplatesApp } from './routes/reminder-templates'
import { remindersApp } from './routes/reminders'
import { remittancesApp } from './routes/remittances'
import { reportsApp } from './routes/reports'
import { reportsInjectionApp } from './routes/reports-injection'
import { requestTypesApp } from './routes/request-types'
import { rolesApp } from './routes/roles'
import { salesApp } from './routes/sales'
import { scheduledRemindersApp } from './routes/scheduled-reminders'
import { seedApp } from './routes/seed'
import { servicesApp } from './routes/services'
import { settingsApp } from './routes/settings'
import { signingApp } from './routes/signing'
import { smsApp } from './routes/sms'
import { specialistPayoutsApp } from './routes/specialist-payouts'
import { specialistsApp } from './routes/specialists'
import { staffApp } from './routes/staff'
import { staffAuthApp } from './routes/staff-auth'
import { staffCredentialsApp } from './routes/staff-credentials'
import { staffPortalApp } from './routes/staff-portal'
import { staffRegistrationApp } from './routes/staff-registration'
import { staffTimelineApp } from './routes/staff-timeline'
import { suppliersApp } from './routes/suppliers'
import { syncApp } from './routes/sync'
import { syncPreviewApp } from './routes/sync-preview'
import { taskApp } from './routes/tasks'
import { taxCalculationsApp } from './routes/tax-calculations'
import { taxConfigurationsApp } from './routes/tax-configurations'
import { treatmentPlansApp } from './routes/treatment-plans'
import { treatmentsApp } from './routes/treatments'
import { uploadApp } from './routes/upload'
import { usersApp } from './routes/users'
import { walkInApp } from './routes/walk-in'
import { walletApp } from './routes/wallet'
import { websiteBookingsApp } from './routes/website-bookings'
import { whtCitApp } from './routes/wht-cit'
import { worklistApp } from './routes/worklist'
import { xraysApp } from './routes/xrays'

function getAllowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Supports exact origins and wildcard subdomains starting with `*.`
// `*.portal-22g.pages.dev` matches:
//   - portal-22g.pages.dev (the bare domain)
//   - staging.portal-22g.pages.dev (branch alias)
//   - abc123.portal-22g.pages.dev (per-commit preview)
function isOriginAllowed(origin: string, patterns: string[]): boolean {
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false
  }
  for (const pattern of patterns) {
    if (pattern === origin) return true
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2) // "portal-22g.pages.dev"
      if (hostname === base || hostname.endsWith(`.${base}`)) return true
    }
  }
  return false
}

export const app = new Hono<HonoEnv>()

// Enable CORS for all API routes
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      if (!origin) return null
      const allowed = getAllowedOrigins()
      return isOriginAllowed(origin, allowed) ? origin : null
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'X-CSRF-Token',
      'X-App-Id',
    ],
    credentials: true,
  })
)

// Detect which frontend interface is calling (portal vs pwa) from the Origin header.
// Sets c.var.interface — used by auth/permissions to scope permission resolution.
app.use('/api/*', detectInterface())

// The staff-administration APIs (/api/staff, /api/hr, /api/hr3, /api/payroll)
// serve the portal and the HR app only; the Team app's self-service lives under
// /api/staff-portal. Needs no session, so it runs before the scope guard.
app.use('/api/*', blockTeamAppFromStaffAdmin())

// Server-side interface-scope guard (defense-in-depth). Enforces that a request
// from a known app interface (portal/pwa/hr) comes from a user holding that scope.
// Rollout via SCOPE_ENFORCEMENT (off|dryrun|hr|all); defaults to all.
app.use('/api/*', enforceInterfaceScope())

// X-Request-ID — attach a trace ID to every request and echo it in the response
app.use('/api/*', async (c, next) => {
  const id = c.req.header('X-Request-ID') ?? crypto.randomUUID()
  c.set('requestId', id)
  await next()
  c.res.headers.set('X-Request-ID', id)
})

// Body size guard — reject oversized payloads before they reach route handlers
app.use('/api/*', async (c, next) => {
  const limit = bodyLimitFor(c.req.path)
  const contentLength = Number(c.req.header('Content-Length') ?? 0)
  if (contentLength > limit) {
    return c.json({ error: 'Payload too large' }, 413)
  }
  return next()
})

// Private files: stored references ⇄ short-lived signed links, on every JSON
// response and request (lib/private-file-links.ts). After the size guard, which
// must reject an oversized body before this layer reads it; before the audit
// log and every route — the Better Auth handler included — so they see
// references, never expiring links.
app.use('/api/*', privateFileLinks())

// Audit Logging Middleware - logs all mutations (POST, PUT, PATCH, DELETE)
app.use('/api/*', auditMiddleware())

// CSRF (double-submit cookie). Issues the token on safe methods and verifies
// the matching X-CSRF-Token header on POST/PUT/PATCH/DELETE. Bypass list (in
// lib/csrf.ts) covers /api/auth/*, /api/health, /api/csrf, /api/website-bookings,
// /api/xrays/public, the Anviz attendance webhook and /api/internal/cron — each
// of which has its own protection or is public.
app.use('/api/*', csrfMiddleware())

// OpenAPI spec + Swagger UI (no auth required — public docs)
app.route('/api', openapiApp)

// Healthcheck Route.
//
// `db` is a DEV-ONLY field: it says which database this process is wired to
// (Docker vs Neon), which the dev UI shows as a pill so you can never again
// debug against the wrong one. It is omitted outside development — /api/health
// is public and unauthenticated, so production must not advertise its stack.
app.get('/api/health', (c) => {
  const base = { status: 'ok', service: 'denel-backend' }
  if ((process.env.APP_ENV ?? process.env.NODE_ENV) !== 'development') return c.json(base)
  return c.json({ ...base, db: describeDbFlavor(process.env.DATABASE_URL) })
})

// CSRF token bootstrap — fresh clients can call this once to mint a token
// before issuing their first mutation. Safe-method requests already mint the
// token transparently, so this endpoint is only needed when the SPA wants an
// explicit warm-up (e.g. on login pages that POST immediately).
app.get('/api/csrf', (c) => {
  const token = ensureCsrfCookie(c)
  return c.json({ token })
})

// Explicit preflight handler for Better Auth routes — return 204 with CORS
// headers before anything else runs. Some Better Auth builds don't answer
// OPTIONS, and the outer cors() middleware can miss when a same-path GET
// handler sits above the OPTIONS check. Handle it manually to be safe.
app.options('/api/auth/*', (c) => {
  const origin = c.req.header('Origin')
  const allowed = getAllowedOrigins()
  const headers = new Headers()
  if (origin && isOriginAllowed(origin, allowed)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Credentials', 'true')
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    headers.set(
      'Access-Control-Allow-Headers',
      c.req.header('Access-Control-Request-Headers') ??
        'Content-Type, Authorization, Accept, Origin, X-Requested-With, X-CSRF-Token'
    )
    headers.set('Access-Control-Max-Age', '600')
    headers.set('Vary', 'Origin')
  }
  return new Response(null, { status: 204, headers })
})

// Better Auth handler — handles non-OPTIONS /api/auth/* routes
app.all('/api/auth/*', async (c, next) => {
  const origin = c.req.header('Origin')
  const allowedOrigins = getAllowedOrigins()

  // Hand off to the custom auth router (mounted below) for the paths it owns.
  // Sourced from routes/auth.ts so adding a route there cannot silently 404.
  if (CUSTOM_AUTH_PATHS.has(c.req.path)) {
    return await next()
  }

  const withCors = (res: Response): Response => {
    if (origin && isOriginAllowed(origin, allowedOrigins)) {
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', origin)
      headers.set('Access-Control-Allow-Credentials', 'true')
      headers.set('Vary', 'Origin')
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      })
    }
    return res
  }

  // Per-account sign-in throttle (lib/login-limiter.ts). Better Auth's own
  // limit is IP-keyed, so it does nothing against a distributed attempt; this
  // layer is keyed on the identifier and applies wherever the attempt is from.
  // Wrapped here rather than in a Better Auth hook so it does not depend on
  // that library's internals.
  //
  // It also has to stand in for Better Auth's limiter entirely, not just
  // complement it: when no client address can be resolved, Better Auth's rate
  // limiter does not fall back — it logs one warning per PROCESS and then skips
  // the limit for every request thereafter
  // (`dist/api/rate-limiter/index.mjs`, `if (!ip) return null`). Since
  // `advanced.ipAddress.ipAddressHeaders` was narrowed to the single trusted
  // header (C1), "no address" is exactly what happens whenever the deployment
  // is not behind the intended proxy. Sign-in and password reset must therefore
  // be capped by something that never depends on the address.
  const isSignIn = c.req.path === '/api/auth/sign-in/email'
  // Better Auth 1.6 renamed `/forget-password` to `/request-password-reset`;
  // only the latter is mounted (the former 404s). Both are matched so a client
  // still on the old name cannot slip past the cap if the alias ever returns.
  const isPasswordReset =
    c.req.path === '/api/auth/request-password-reset' || c.req.path === '/api/auth/forget-password'
  let identifier: string | null = null
  if (isSignIn || isPasswordReset) {
    // Parsed with the SAME content-type rules better-call applies before it
    // hands the body to Better Auth — see lib/auth-identifier.ts. Reading this
    // with `json()` alone meant a urlencoded body authenticated normally while
    // the throttle, the failure counter and the auth-event record all saw
    // nothing, which defeated the entire per-account limit.
    const read = await readAuthIdentifier(c.req.raw)
    if (read.kind === 'found') identifier = read.identifier

    // FAIL CLOSED. An attempt we cannot attribute to an account is exactly the
    // bypass this layer exists to stop, so it is refused here rather than
    // forwarded to the kernel uncounted. Better Auth would answer its own
    // validation error for these bodies anyway — the difference is that it
    // would answer it without the attempt being capped.
    if (read.kind !== 'found') {
      return withCors(
        new Response(
          JSON.stringify({
            message: 'Request body must carry an email address.',
            code: 'UNATTRIBUTABLE_CREDENTIAL',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      )
    }

    // Namespaced so a reset flood cannot lock the account out of sign-in, and
    // a sign-in flood cannot block a legitimate reset.
    const throttleKey = identifier && (isPasswordReset ? `reset:${identifier}` : identifier)
    if (throttleKey) {
      const throttle = await checkIdentifierThrottle(throttleKey)
      if (!throttle.allowed) {
        const retryAfterSec = Math.ceil(throttle.retryAfterMs / 1000)
        recordAuthEvent({
          event: isPasswordReset ? 'password_reset_request' : 'sign_in',
          outcome: 'blocked',
          identifier,
          reason: 'throttled',
          appScope: resolveAppScope(c),
          ipAddress: clientIp(c),
          userAgent: c.req.header('User-Agent') ?? null,
        })
        return withCors(
          new Response(
            JSON.stringify({
              message: isPasswordReset
                ? 'Too many password reset requests. Try again shortly.'
                : 'Too many failed sign-in attempts. Try again shortly.',
              code: isPasswordReset ? 'RESET_RATE_LIMITED' : 'ACCOUNT_TEMPORARILY_LOCKED',
            }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': String(retryAfterSec),
              },
            }
          )
        )
      }
    }
  }

  // Sign-out has to be attributed BEFORE the kernel runs — afterwards the
  // session is gone and there is no actor left to name. One extra session read,
  // on sign-out only.
  const isSignOut = c.req.path === '/api/auth/sign-out'
  const signingOut = isSignOut ? await getCurrentUser(c).catch(() => null) : null

  try {
    const auth = getAuth(c)
    const response = await auth.handler(c.req.raw)

    if (isSignOut) {
      recordAuthEvent({
        event: 'sign_out',
        outcome: response.ok ? 'success' : 'failure',
        userId: signingOut?.id ?? null,
        identifier: signingOut?.email ?? null,
        appScope: resolveAppScope(c),
        ipAddress: clientIp(c),
        userAgent: c.req.header('User-Agent') ?? null,
      })
    }

    if (identifier) {
      // Record against the resolved client address when there is one. A null ip
      // still records the attempt — the identifier layer is what matters here,
      // and dropping the row would hand an attacker a way to avoid counting.
      const ip = clientIp(c) ?? 'unknown'

      // M2 — the authentication trail. This is the one place every
      // email+password sign-in and every reset request already passes through,
      // so it is where the record belongs; putting it in a Better Auth hook
      // would miss the throttle rejections above, which never reach the kernel.
      recordAuthEvent({
        event: isPasswordReset ? 'password_reset_request' : 'sign_in',
        outcome: response.ok ? 'success' : 'failure',
        identifier,
        reason: response.ok ? null : `http_${response.status}`,
        appScope: resolveAppScope(c),
        ipAddress: clientIp(c),
        userAgent: c.req.header('User-Agent') ?? null,
      })

      if (isSignIn) {
        if (response.ok) {
          await recordSuccess(identifier, ip).catch(() => {})
        } else if (response.status === 401 || response.status === 400) {
          await recordFailure(identifier, ip).catch(() => {})
        }
      } else if (isPasswordReset) {
        // Every reset request counts, successful or not. Better Auth answers
        // 200 whether or not the address exists (deliberately, to avoid
        // enumeration), so "did it work" carries no signal — what needs capping
        // is the volume of emails one address can be made to receive.
        await recordFailure(`reset:${identifier}`, ip).catch(() => {})
      }
    }

    return withCors(response)
  } catch (err) {
    logError(err, { context: '[auth handler] Unhandled exception' })
    const errRes = new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
    return withCors(errRes)
  }
})

// Custom auth routes (e.g. /api/auth/check-permission)
app.route('/api/auth', authApp)
app.route('/api/users', usersApp)
app.route('/api/patients', patientsApp)
app.route('/api/appointment-type-reminders', appointmentTypeRemindersApp)
app.route('/api/appointments', appointmentsApp)
app.route('/api/payments', paymentsApp)
app.route('/api/app-payment-methods', appPaymentMethodsApp)
app.route('/api/payment-confirmations', paymentConfirmationsApp)
app.route('/api/payment-plans', paymentPlansApp)
app.route('/api/expenses', expensesApp)
app.route('/api/petty-cash', pettyCashApp)
app.route('/api/inventory', inventoryApp)
app.route('/api/breakfast', breakfastApp)
app.route('/api/items', itemsApp)
app.route('/api/kiosk', kioskApp)
app.route('/api/documents', documentsApp)
app.route('/api/sign', signingApp)
app.route('/api/icd10-codes', icd10CodesApp)
app.route('/api/products', productsApp)
app.route('/api/medical-records', medicalRecordsApp)
app.route('/api/odontogram', odontogramApp)
app.route('/api/perio-chart', perioApp)
app.route('/api/patient-media', patientMediaApp)
app.route('/api/treatment-plans', treatmentPlansApp)
app.route('/api/appointment-workflow', appointmentWorkflowApp)
app.route('/api/recare', recareApp)
app.route('/api/patient-reminders', patientRemindersApp)
app.route('/api/patient-tags', patientTagsApp)
app.route('/api/patient-statements', patientStatementsApp)
app.route('/api/insurance', insuranceApp)
app.route('/api/insurance', insurancePricingApp)
app.route('/api/insurance', insuranceClaimsApp)
app.route('/api/integrations', integrationsApp)
app.route('/api/internal/cron', internalCron)
app.route('/api/labs', labsApp)
app.route('/api/xrays', xraysApp)
app.route('/api/aging-report', agingReportApp)
app.route('/api/staff-credentials', staffCredentialsApp)
app.route('/api/consent-forms', consentFormsApp)
app.route('/api/suppliers', suppliersApp)
app.route('/api/tax-calculations', taxCalculationsApp)
app.route('/api/tax-configurations', taxConfigurationsApp)
app.route('/api/doctors', doctorsApp)
app.route('/api/reports', reportsApp)
app.route('/api/reports-injection', reportsInjectionApp)
app.route('/api/dashboard', dashboardApp)
app.route('/api/staff', staffApp)
app.route('/api/staff-auth', staffAuthApp)
app.route('/api/staff-registration', staffRegistrationApp)
app.route('/api/staff-portal', staffPortalApp)
app.route('/api/staff-timeline', staffTimelineApp)
app.route('/api/request-types', requestTypesApp)
app.route('/api/push', pushApp)
app.route('/api/tasks', taskApp)
app.route('/api/messages', messagesApp)
app.route('/api/sms', smsApp)
app.route('/api/specialists', specialistsApp)
app.route('/api/specialist-payouts', specialistPayoutsApp)
app.route('/api/email', emailApp)
app.route('/api/financials', financialsApp)
app.route('/api/settings', settingsApp)
app.route('/api/lookups', lookupsApp)
app.route('/api/sales', salesApp)
app.route('/api/sync', syncApp)
app.route('/api/sync-preview', syncPreviewApp)
app.route('/api/database', databaseApp)
app.route('/api/audit-logs', auditLogsApp)
app.route('/api/reminders', remindersApp)
app.route('/api/remittances', remittancesApp)
app.route('/api/reminder-templates', reminderTemplatesApp)
app.route('/api/website-bookings', websiteBookingsApp)
app.route('/api/api-keys', apiKeysApp)
app.route('/api/scheduled-reminders', scheduledRemindersApp)
app.route('/api/ortho-consent', orthoConsentApp)
app.route('/api/treatments', treatmentsApp)
app.route('/api/seed', seedApp)
app.route('/api/upload', uploadApp)
app.route('/api/ledger-adjustments', ledgerAdjustmentsApp)
app.route('/api/diag', diagApp)
analyticsApp.route('/', analyticsExportApp)
analyticsApp.route('/', analyticsStoreApp)
analyticsApp.route('/', analyticsCrmApp)
analyticsApp.route('/', analyticsInsuranceApp)
analyticsApp.route('/', analyticsDataIntegrityApp)
analyticsApp.route('/', analyticsWorkforceExtendedApp)
analyticsApp.route('/', analyticsSpecialistExtendedApp)
analyticsApp.route('/', analyticsClinicalExtendedApp)
app.route('/api/analytics', analyticsApp)
app.route('/api/financial-analytics', financialAnalyticsApp)
app.route('/api/google-calendar', googleCalendarApp)
app.route('/api/google-contacts', googleContactsApp)
app.route('/api/compliance', complianceApp)
app.route('/api/roles', rolesApp)
app.route('/api/invoices', invoicesApp)
app.route('/api/walk-in', walkInApp)
app.route('/api/worklist', worklistApp)
app.route('/api/credit-notes', creditNotesApp)
app.route('/api/crm', crmApp)
app.route('/api/bills', billsApp)
app.route('/api/deferred-revenue', deferredRevenueApp)
app.route('/api/wallet', walletApp)
app.route('/api/patient-timeline', patientTimelineApp)
app.route('/api/patient-cases', patientCasesApp)
app.route('/api/clinic-ledger', clinicLedgerApp)
app.route('/api/patient-auth', patientAuthApp)
app.route('/api/patient-portal', patientPortalApp)
app.route('/api/services', servicesApp)
app.route('/api/access-management', accessManagementApp)
app.route('/api/hr', hrPhase2)
app.route('/api/hr3', hrPhase34)
app.route('/api/payroll', payrollApp)
// ── Phase 1: General Ledger foundation ──────────────────────────────────────
app.route('/api/accounts', accountsApp)
app.route('/api/activities', activitiesApp)
app.route('/api/periods', periodsApp)
app.route('/api/journal-entries', journalEntriesApp)
app.route('/api/finance-health', financeHealthApp)
app.route('/api/fixed-assets', fixedAssetsApp)
app.route('/api', whtCitApp) // /api/wht-certificates + /api/cit-installments (F3/F4)

// ── Settings lookup tables ────────────────────────────────────────────────────
app.route('/api/document-tags', documentTagsApp)
app.route('/api/inventory-locations', inventoryLocationsApp)
app.route('/api/compliance-categories', complianceCategoriesApp)
app.route('/api/consent-templates', consentTemplatesApp)

// Global error handler
app.onError((err, c) => {
  logError(err, { context: '[onError] Unhandled error' })
  Sentry.captureException(err, {
    extra: {
      path: c.req.path,
      method: c.req.method,
      requestId: c.var.requestId,
    },
  })
  const origin = c.req.header('Origin')
  const allowedOrigins = getAllowedOrigins()
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (origin && isOriginAllowed(origin, allowedOrigins)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Credentials', 'true')
    headers.set('Vary', 'Origin')
  }
  return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers })
})
