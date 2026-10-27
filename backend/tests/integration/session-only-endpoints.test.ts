/**
 * F23 — endpoints that checked only that someone was signed in. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.12).
 *
 * A signed-in session was enough for these reads and writes: the service price lists, the Google
 * Calendar sync status and a forced re-sync of ANY appointment, the activity worklist, queuing a
 * pending medical note, the analytics dashboard, the Data Inject configuration, the compliance
 * categories, the inventory locations, the list of roles and every lookup list. A Team-app or HR
 * session could therefore read and, for some, write surfaces that belong to the clinic portal.
 *
 * Each now requires the module it serves, and the clinic-portal ones refuse the Team app and the HR
 * app outright. The table below is the contract: for every endpoint, the personas that are let in
 * (anything but 401/403: the request may then be rejected for its own content) and, by omission,
 * the ones that get 403.
 *
 * Real stack: real app, real sessions, real permission engine. Nothing is mocked but SMS and Google
 * Calendar. Commits login fixtures only; local Postgres only; they are removed in afterAll.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/session-only-endpoints.test.ts
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))
vi.mock('../../src/lib/google-calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/google-calendar')>()),
  enrichAppointment: vi.fn(async () => null),
  syncAppointmentCreated: vi.fn(async () => null),
  syncAppointmentDeleted: vi.fn(async () => null),
  syncAppointmentUpdated: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import { roleBundles, roleScopes, roles } from '../../src/db/schema'
import {
  callAs,
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  type Interface,
  isLocalDb,
  localDb,
  signInAs,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
const APP_BOOT_TIMEOUT_MS = 180_000
const db = localDb() as DB
const TAG = `soe-${Date.now()}`
const MISSING = '00000000-0000-0000-0000-000000000000'

type Who = 'admin' | 'recep' | 'doctor' | 'hr' | 'trainer' | 'staff' | 'lab' | 'dashonly'
const ALL: Who[] = ['admin', 'recep', 'doctor', 'hr', 'trainer', 'staff', 'lab', 'dashonly']
/** A portal user whose custom role holds the dashboard and nothing else. */
const DASH_ROLE = `soe-dashboard-only-${Date.now()}`
const IFACE: Record<Who, Interface> = {
  admin: 'portal',
  recep: 'portal',
  doctor: 'portal',
  hr: 'hr',
  trainer: 'hr',
  staff: 'pwa',
  lab: 'pwa',
  dashonly: 'portal',
}
const ROLE: Record<Who, string> = {
  admin: 'admin',
  recep: 'receptionist',
  doctor: 'doctor',
  hr: 'hr_admin',
  trainer: 'external_trainer',
  staff: 'staff',
  lab: 'lab_technician',
  dashonly: DASH_ROLE,
}

let app: TestApp
const cookies = {} as Record<Who, string>
const userIds: string[] = []

const request = (who: Who, method: string, path: string, body?: unknown) =>
  callAs(app, IFACE[who], cookies[who], method, path, body)

type Endpoint = {
  label: string
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  /** Everyone not listed gets 403. */
  allowed: Who[]
}

const PORTAL_CLINIC: Who[] = ['admin', 'recep', 'doctor']

const ENDPOINTS: Endpoint[] = [
  // ── service price lists ───────────────────────────────────────────────────
  {
    label: 'services lookup',
    method: 'GET',
    path: `/api/services/lookup?serviceId=${MISSING}`,
    allowed: PORTAL_CLINIC,
  },
  { label: 'services scopes', method: 'GET', path: '/api/services/scopes', allowed: PORTAL_CLINIC },
  {
    label: 'services tooth classes',
    method: 'GET',
    path: '/api/services/tooth-classes',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'services resolve-price',
    method: 'POST',
    path: '/api/services/resolve-price',
    body: {},
    allowed: PORTAL_CLINIC,
  },
  { label: 'services taxes', method: 'GET', path: '/api/services/taxes', allowed: PORTAL_CLINIC },
  {
    label: 'service price matrix',
    method: 'GET',
    path: `/api/services/${MISSING}/prices`,
    allowed: PORTAL_CLINIC,
  },
  // ── Google Calendar ───────────────────────────────────────────────────────
  {
    label: 'calendar status',
    method: 'GET',
    path: '/api/google-calendar/status',
    // the caller's own connection: any portal user, no module needed
    allowed: [...PORTAL_CLINIC, 'dashonly'],
  },
  {
    label: 'calendar sync status of an appointment',
    method: 'GET',
    path: `/api/google-calendar/appointment-sync/${MISSING}`,
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'calendar re-sync of an appointment',
    method: 'POST',
    path: `/api/google-calendar/appointment-sync/${MISSING}/resync`,
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'calendar per-doctor status',
    method: 'GET',
    path: '/api/google-calendar/per-doctor-status',
    allowed: ['admin'],
  },
  // ── worklist, notes, recare ───────────────────────────────────────────────
  {
    label: 'activities completed',
    method: 'GET',
    path: '/api/activities/completed',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'activities complete',
    method: 'POST',
    path: '/api/activities/complete',
    body: { activityType: 'nonsense' },
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'recare auto-from-record',
    method: 'POST',
    path: '/api/recare/auto-from-record',
    body: {},
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'queue a pending medical note',
    method: 'POST',
    path: '/api/medical-records/pending',
    body: {},
    allowed: PORTAL_CLINIC,
  },
  // ── dashboards and small lists ────────────────────────────────────────────
  { label: 'analytics', method: 'GET', path: '/api/analytics?year=2026', allowed: PORTAL_CLINIC },
  {
    label: 'data inject configuration',
    method: 'GET',
    path: '/api/reports-injection',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'compliance categories',
    method: 'GET',
    path: '/api/compliance-categories',
    allowed: ['admin', 'recep'],
  },
  {
    label: 'inventory locations',
    method: 'GET',
    path: '/api/inventory-locations',
    allowed: PORTAL_CLINIC,
  },
  { label: 'roles', method: 'GET', path: '/api/users/roles', allowed: ['admin'] },
  // ── the treatment-type list, served a second way ──────────────────────────
  { label: 'treatments', method: 'GET', path: '/api/treatments', allowed: PORTAL_CLINIC },
  { label: 'treatments (all)', method: 'GET', path: '/api/treatments/all', allowed: PORTAL_CLINIC },
  {
    label: 'treatment ADA groups',
    method: 'GET',
    path: '/api/treatments/ada-groups',
    allowed: PORTAL_CLINIC,
  },
  // ── lookups: each type goes to the modules that use it ────────────────────
  {
    label: 'lookup: payment methods',
    method: 'GET',
    path: '/api/lookups/payment-methods',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'lookup: appointment types',
    method: 'GET',
    path: '/api/lookups/appointment-types',
    allowed: PORTAL_CLINIC,
  },
  { label: 'lookup: units', method: 'GET', path: '/api/lookups/units', allowed: PORTAL_CLINIC },
  {
    label: 'lookup: categories',
    method: 'GET',
    path: '/api/lookups/categories',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'lookup: treatment types',
    method: 'GET',
    path: '/api/lookups/treatment-types',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'lookup: examination types',
    method: 'GET',
    path: '/api/lookups/examination-types',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'lookup: allergies',
    method: 'GET',
    path: '/api/lookups/allergies',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'lookup: drug frequencies',
    method: 'GET',
    path: '/api/lookups/drug-frequencies',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'lookup: lab case statuses',
    method: 'GET',
    path: '/api/lookups/lab-case-statuses',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'lookup: expense categories',
    method: 'GET',
    path: '/api/lookups/expense-categories',
    allowed: ['admin', 'recep'],
  },
  {
    label: 'lookup: compliance tags',
    method: 'GET',
    path: '/api/lookups/compliance-tags',
    allowed: ['admin', 'recep'],
  },
  {
    label: 'lookup: staff titles',
    method: 'GET',
    path: '/api/lookups/staff-titles',
    allowed: ['admin', 'hr'],
  },
  {
    label: 'lookup: employment types',
    method: 'GET',
    path: '/api/lookups/employment-types',
    allowed: ['admin', 'hr'],
  },
  {
    label: 'lookup: departments',
    method: 'GET',
    path: '/api/lookups/hr-departments',
    allowed: ['admin', 'hr'],
  },
  {
    label: 'lookup: specialties',
    method: 'GET',
    path: '/api/lookups/specialties',
    allowed: ['admin', 'hr'],
  },
  {
    label: 'lookup: staff document types (also the Team app’s own documents)',
    method: 'GET',
    path: '/api/lookups/staff-document-types',
    allowed: ['admin', 'hr', 'staff', 'lab'],
  },
  {
    label: 'lookup list incl. inactive: payment methods',
    method: 'GET',
    path: '/api/lookups/payment-methods/all',
    allowed: PORTAL_CLINIC,
  },
  {
    label: 'lookup list incl. inactive: staff titles',
    method: 'GET',
    path: '/api/lookups/staff-titles/all',
    allowed: ['admin', 'hr'],
  },
]

describe.skipIf(skip)('endpoints that used to need only a session (F23)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp
    await db.insert(roles).values({ id: DASH_ROLE, name: DASH_ROLE, isSystem: false })
    await db.insert(roleScopes).values({ roleId: DASH_ROLE, interfaceScope: 'portal' })
    await db.insert(roleBundles).values({ roleId: DASH_ROLE, bundleId: 'bundle_dashboard' })
    for (const who of ALL) {
      const email = `${who}-${TAG}@soe.test`
      userIds.push(
        await createLoginUser(db, {
          email,
          name: `SOE ${who}`,
          roleId: ROLE[who],
          baRole: who === 'admin' ? 'admin' : undefined,
        })
      )
      cookies[who] = await signInAs(app, email, IFACE[who])
    }
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await deleteLoginUsers(db, userIds)
    await db.delete(roles).where(eq(roles.id, DASH_ROLE))
  })

  for (const ep of ENDPOINTS) {
    describe(`${ep.method} ${ep.path.split('?')[0]} — ${ep.label}`, () => {
      for (const who of ALL) {
        const let_in = ep.allowed.includes(who)
        it(`${let_in ? 'lets in' : 'refuses'} ${who}`, async () => {
          const res = await request(who, ep.method, ep.path, ep.body)
          if (let_in) {
            expect([401, 403], JSON.stringify(res.json)).not.toContain(res.status)
          } else {
            expect(res.status, JSON.stringify(res.json)).toBe(403)
          }
        })
      }
    })
  }

  it('refuses someone who is not signed in, for every one of them', async () => {
    for (const ep of ENDPOINTS) {
      const res = await callAs(app, 'portal', '', ep.method, ep.path, ep.body)
      expect(res.status, ep.path).toBe(401)
    }
  })

  it('an unknown lookup type is still a 400 for someone allowed to read lookups', async () => {
    const res = await request('admin', 'GET', '/api/lookups/not-a-type')
    expect(res.status).toBe(400)
  })
})
