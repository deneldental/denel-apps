/**
 * Who may READ each lookup list (F23).
 *
 * `GET /api/lookups/:type` checked only that someone was signed in, so a Team-app or HR session
 * could read every clinical, financial and staff list in the system. Each type now goes to the
 * modules whose screens use it, and the clinical and financial lists are for the clinic portal
 * only. Writing a lookup has its own gate (`canWriteLookup` in routes/lookups.ts) and is unchanged.
 *
 * Every type in the route's table needs a rule here; the route refuses to load without one, so a
 * new lookup type cannot ship readable by everyone by default.
 */
import { ACTIONS, MODULES } from './modules'
import type { AccessRule, Permission } from './route-access'

const read = (module: string): Permission => [module, ACTIONS.READ]

const PORTAL = ['portal'] as const

const CLINICAL_OPTIONS: AccessRule = {
  apps: PORTAL,
  anyOf: [read(MODULES.MEDICAL_RECORDS), read(MODULES.PATIENTS), read(MODULES.SETTINGS)],
}

/** The HR lists are used by the HR app and by the portal screens that edit staff and specialists. */
const HR_LIST: AccessRule = {
  apps: ['portal', 'hr'],
  anyOf: [read(MODULES.STAFF), read(MODULES.SPECIALISTS), read(MODULES.SETTINGS)],
}

export const LOOKUP_READ_RULES: Readonly<Record<string, AccessRule>> = {
  // finance
  'expense-categories': {
    apps: PORTAL,
    anyOf: [read(MODULES.EXPENSES), read(MODULES.SETTINGS)],
  },
  'payment-methods': {
    apps: PORTAL,
    anyOf: [
      read(MODULES.PAYMENTS),
      read(MODULES.EXPENSES),
      read(MODULES.ESTIMATES),
      read(MODULES.SETTINGS),
    ],
  },
  // stock
  categories: {
    apps: PORTAL,
    anyOf: [
      read(MODULES.INVENTORY),
      read(MODULES.ITEMS),
      read(MODULES.PRODUCTS),
      read(MODULES.SETTINGS),
    ],
  },
  units: {
    apps: PORTAL,
    anyOf: [
      read(MODULES.INVENTORY),
      read(MODULES.ITEMS),
      read(MODULES.PRODUCTS),
      read(MODULES.SETTINGS),
    ],
  },
  // appointments and treatments
  'appointment-types': {
    apps: PORTAL,
    anyOf: [read(MODULES.APPOINTMENTS), read(MODULES.MESSAGING), read(MODULES.SETTINGS)],
  },
  'examination-types': {
    apps: PORTAL,
    anyOf: [
      read(MODULES.MEDICAL_RECORDS),
      read(MODULES.XRAYS),
      read(MODULES.APPOINTMENTS),
      read(MODULES.SETTINGS),
    ],
  },
  'treatment-types': {
    apps: PORTAL,
    anyOf: [
      read(MODULES.APPOINTMENTS),
      read(MODULES.MEDICAL_RECORDS),
      read(MODULES.PATIENTS),
      read(MODULES.ESTIMATES),
      read(MODULES.SERVICES),
      read(MODULES.RECARE),
      read(MODULES.SETTINGS),
    ],
  },
  // clinical stage options
  'presenting-complaints': CLINICAL_OPTIONS,
  'past-medical-history': CLINICAL_OPTIONS,
  'drug-history-items': CLINICAL_OPTIONS,
  allergies: CLINICAL_OPTIONS,
  'social-history-items': CLINICAL_OPTIONS,
  'dental-review-items': CLINICAL_OPTIONS,
  'ortho-treatments': CLINICAL_OPTIONS,
  'drug-frequencies': CLINICAL_OPTIONS,
  // lab and compliance
  'lab-case-statuses': { apps: PORTAL, anyOf: [read(MODULES.LABS), read(MODULES.SETTINGS)] },
  'compliance-tags': { apps: PORTAL, anyOf: [read(MODULES.COMPLIANCE), read(MODULES.SETTINGS)] },
  // HR
  'staff-titles': HR_LIST,
  'employment-types': HR_LIST,
  'hr-departments': HR_LIST,
  specialties: HR_LIST,
  // The Team app also reads this one, for the documents a staff member adds about themselves.
  'staff-document-types': { ...HR_LIST, apps: ['portal', 'hr', 'pwa'], openIn: ['pwa'] },
}
