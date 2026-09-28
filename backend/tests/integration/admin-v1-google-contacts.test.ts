/**
 * admin-v1 §21.4 — Google Contacts ↔ CRM sync: pure mapping/merge/dedupe logic.
 *
 * The OAuth flow + People API calls need Google creds and a live network, so
 * they are NOT exercised here. What IS load-bearing and fully testable without
 * creds is the contact ↔ patient field mapping and the dedupe-by-phone merge
 * planner — a bug there means duplicate contact cards or clobbered patients.
 *
 * Most assertions are pure (no DB). One test pulls a patient row through a real
 * `withRollback` transaction to prove the planner consumes the actual
 * `patients` row shape the route passes in. The sandbox tx is always rolled
 * back — the shared dev DB is never mutated.
 *
 * Run with `doppler run -- pnpm --filter backend test admin-v1-google-contacts`
 * (the DB-backed test is gated on DATABASE_URL; the pure tests always run).
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { patients } from '../../src/db/schema'
import {
  contactsEquivalent,
  type GooglePerson,
  googlePersonToContact,
  indexByPhone,
  type NormalizedContact,
  type PatientLike,
  patientToContact,
  phoneKeyOf,
  planContactImport,
  planContactSync,
} from '../../src/lib/google-contacts-service'
import { noDb, withRollback } from './_setup'

function patient(p: Partial<PatientLike> & { name: string }): PatientLike {
  return { id: p.id ?? randomUUID(), name: p.name, email: p.email ?? null, phone: p.phone ?? null }
}

function person(p: {
  name?: string
  email?: string
  phone?: string
  canonical?: string
}): GooglePerson {
  const out: GooglePerson = {}
  if (p.name) out.names = [{ displayName: p.name }]
  if (p.email) out.emailAddresses = [{ value: p.email }]
  if (p.phone || p.canonical) out.phoneNumbers = [{ value: p.phone, canonicalForm: p.canonical }]
  return out
}

describe('Google Contacts — phoneKeyOf (dedupe key)', () => {
  it('collapses local, 0-prefixed and +233 forms to the same key', () => {
    const a = phoneKeyOf('0241234567')
    const b = phoneKeyOf('+233 24 123 4567')
    const c = phoneKeyOf('233241234567')
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a.length).toBeGreaterThanOrEqual(10)
  })

  it('returns "" for missing or too-short numbers', () => {
    expect(phoneKeyOf(null)).toBe('')
    expect(phoneKeyOf(undefined)).toBe('')
    expect(phoneKeyOf('')).toBe('')
    expect(phoneKeyOf('123')).toBe('')
  })
})

describe('Google Contacts — field mapping', () => {
  it('maps a patient row → normalized contact, trimming blanks to null', () => {
    const c = patientToContact(
      patient({ name: '  Ama Boateng ', email: '  ', phone: '0241234567' })
    )
    expect(c.name).toBe('Ama Boateng')
    expect(c.email).toBeNull()
    expect(c.phone).toBe('0241234567')
    expect(c.phoneKey).toBe(phoneKeyOf('0241234567'))
  })

  it('maps a Google person → normalized contact, preferring canonicalForm phone', () => {
    const c = googlePersonToContact(
      person({
        name: 'Kofi Mensah',
        email: 'kofi@example.com',
        phone: '024-123-4567',
        canonical: '+233241234567',
      })
    )
    expect(c.name).toBe('Kofi Mensah')
    expect(c.email).toBe('kofi@example.com')
    expect(c.phone).toBe('+233241234567') // canonicalForm wins
    expect(c.phoneKey).toBe(phoneKeyOf('+233241234567'))
  })

  it('falls back to given+family name when displayName is absent', () => {
    const p: GooglePerson = { names: [{ givenName: 'Yaa', familyName: 'Asantewaa' }] }
    expect(googlePersonToContact(p).name).toBe('Yaa Asantewaa')
  })
})

describe('Google Contacts — contactsEquivalent', () => {
  it('is case/whitespace-insensitive on name + email and uses the phone key', () => {
    const a: NormalizedContact = {
      name: 'Ama Boateng',
      email: 'AMA@x.com',
      phone: '0241234567',
      phoneKey: phoneKeyOf('0241234567'),
    }
    const b: NormalizedContact = {
      name: '  ama boateng ',
      email: ' ama@x.com ',
      phone: '+233241234567',
      phoneKey: phoneKeyOf('+233241234567'),
    }
    expect(contactsEquivalent(a, b)).toBe(true)
  })

  it('differs when the email differs', () => {
    const a = patientToContact(patient({ name: 'X', email: 'a@x.com', phone: '0241234567' }))
    const b = patientToContact(patient({ name: 'X', email: 'b@x.com', phone: '0241234567' }))
    expect(contactsEquivalent(a, b)).toBe(false)
  })
})

describe('Google Contacts — indexByPhone (dedupe)', () => {
  it('drops phone-less contacts and keeps the first on a key collision', () => {
    const first = googlePersonToContact(person({ name: 'First', phone: '0241234567' }))
    const dup = googlePersonToContact(person({ name: 'Dup', phone: '+233241234567' }))
    const noPhone = googlePersonToContact(person({ name: 'Ghost' }))
    const idx = indexByPhone([first, dup, noPhone])
    expect(idx.size).toBe(1)
    expect(idx.get(phoneKeyOf('0241234567'))?.name).toBe('First')
  })
})

describe('Google Contacts — planContactSync (push: patients → Google)', () => {
  it('CREATEs a contact when no Google contact shares the phone', () => {
    const p = patient({ name: 'New Patient', phone: '0241234567' })
    const actions = planContactSync([p], [])
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('create')
  })

  it('SKIPs in_sync when name+email+phone already match (no duplicate card)', () => {
    const p = patient({ name: 'Ama', email: 'ama@x.com', phone: '0241234567' })
    const g = googlePersonToContact(
      person({ name: 'Ama', email: 'ama@x.com', canonical: '+233241234567' })
    )
    const actions = planContactSync([p], [g])
    expect(actions[0].type).toBe('skip')
    expect(actions[0]).toMatchObject({ reason: 'in_sync' })
  })

  it('UPDATEs the matched contact in place when details drifted', () => {
    const p = patient({ name: 'Ama Updated', email: 'new@x.com', phone: '0241234567' })
    const g = googlePersonToContact(
      person({ name: 'Ama', email: 'old@x.com', canonical: '+233241234567' })
    )
    const actions = planContactSync([p], [g])
    expect(actions[0].type).toBe('update')
  })

  it('SKIPs no_phone patients (cannot dedupe without a phone)', () => {
    const p = patient({ name: 'Phoneless' })
    const actions = planContactSync([p], [])
    expect(actions[0]).toMatchObject({ type: 'skip', reason: 'no_phone' })
  })

  it('dedupes two patients that normalize to the same phone against one contact', () => {
    const p1 = patient({ name: 'Ama', email: 'ama@x.com', phone: '0241234567' })
    const p2 = patient({ name: 'Ama', email: 'ama@x.com', phone: '+233241234567' })
    const g = googlePersonToContact(
      person({ name: 'Ama', email: 'ama@x.com', canonical: '+233241234567' })
    )
    const actions = planContactSync([p1, p2], [g])
    // Both already in sync — neither creates a new duplicate card.
    expect(actions.every((a) => a.type === 'skip')).toBe(true)
  })
})

describe('Google Contacts — planContactImport (import: Google → CRM)', () => {
  it('CREATEs a patient when no patient shares the contact phone', () => {
    const g = googlePersonToContact(person({ name: 'Walk-in', phone: '0209998888' }))
    const actions = planContactImport([g], [])
    expect(actions[0].type).toBe('create')
  })

  it('UPDATEs the matched patient and carries its id', () => {
    const existing = patient({ name: 'Old Name', phone: '0241234567' })
    const g = googlePersonToContact(
      person({ name: 'New Name', email: 'n@x.com', canonical: '+233241234567' })
    )
    const actions = planContactImport([g], [existing])
    expect(actions[0]).toMatchObject({ type: 'update', patientId: existing.id })
  })

  it('SKIPs no_phone Google contacts', () => {
    const g = googlePersonToContact(person({ name: 'Ghost' }))
    const actions = planContactImport([g], [])
    expect(actions[0]).toMatchObject({ type: 'skip', reason: 'no_phone' })
  })
})

// DB-backed: prove the planner consumes the REAL patients row shape the route
// selects. Gated on DATABASE_URL; sandbox tx is always rolled back.
describe.skipIf(noDb)('Google Contacts — planner over a real patients row', () => {
  it('plans a CREATE for a freshly-inserted patient with a phone', async () => {
    await withRollback(async (tx) => {
      const [p] = await tx
        .insert(patients)
        .values({
          name: `IT Contact ${randomUUID().slice(0, 8)}`,
          dob: new Date('1990-01-01'),
          gender: 'other',
          phone: '0241234567',
        })
        .returning({
          id: patients.id,
          name: patients.name,
          email: patients.email,
          phone: patients.phone,
        })

      const actions = planContactSync([p], [])
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('create')

      const contact = patientToContact(p)
      expect(contact.phoneKey).toBe(phoneKeyOf('0241234567'))
    })
  })
})
