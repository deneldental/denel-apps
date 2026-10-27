/**
 * `POST /api/ledger-adjustments/expense-bulk` — receipts attached to a bulk expense import. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.14).
 *
 * The route copied the receipt-naming code that F22 removed from `POST /api/upload/expense`:
 *
 *   - the object name was `<category>_<payee>_<day>_<month>_<year>.<ext>`, built from CSV cells with
 *     only whitespace tidied, so a category such as `../../patients/x` put `..` and `/` into the
 *     key, and two receipts for the same category on the same day replaced each other;
 *   - the extension came from the client's file name unchecked, and the file itself was never
 *     validated: any bytes, with any declared type, were stored as a "receipt".
 *
 * It now uses the same key builder as the single-receipt route and the same file checks. A receipt
 * that fails them is reported against its CSV row (the expense is still imported, without the
 * attachment, as it already was for a receipt that could not be found).
 *
 * Real stack: the real app, a real administrator's session and real Postgres; only the object store
 * is replaced, to read what was stored.
 *
 * ── Safety ── commits `expenses` rows whose description is `IT bulk …` and removes them (and any
 * ledger entry posted for them); local Postgres only.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/expense-bulk-attachments.test.ts
 */
import { and, eq, ilike, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const stored = vi.hoisted(
  () => [] as Array<{ category: string; key: string; size: number; contentType: string }>
)

vi.mock('../../src/lib/storage-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/storage-router')>()),
  uploadToCategory: vi.fn(
    async (category: string, key: string, body: Buffer, contentType: string) => {
      stored.push({ category, key, size: body.length, contentType })
      return { url: `private-file://r2/${key}#test`, providerId: 'r2' }
    }
  ),
}))
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import { expenses, journalEntries, journalLines } from '../../src/db/schema'
import {
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  INTERFACES,
  isLocalDb,
  localDb,
  signInAs,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
const APP_BOOT_TIMEOUT_MS = 180_000
const db = localDb() as DB
const TAG = `IT bulk ${Date.now()}`
/** A midday UTC date, so the day is the same in every time zone the suite might run in. */
const DATE = '2026-10-15T12:00:00Z'

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const HTML = Buffer.from('<html><script>alert(1)</script></html>')

let app: TestApp
let cookie = ''
let adminId = ''

/** What the import answers: a message, and a sentence for each row it could not fully import. */
type ImportAnswer = {
  success?: boolean
  error?: string
  data?: { message?: string; errors?: string[] }
}

/** One bulk import: a CSV and the attachments it names, sent the way the portal sends them. */
async function importBulk(
  rows: Array<{ category: string; paidTo?: string; attachment?: string }>,
  files: Record<string, { bytes: Buffer; type: string }>
) {
  const csv = [
    'Date,Amount,Category,Description,PaidTo,Method,Attachment',
    ...rows.map(
      (r) => `${DATE},100,"${r.category}","${TAG}",${r.paidTo ?? ''},cash,${r.attachment ?? ''}`
    ),
  ].join('\n')
  const form = new FormData()
  form.append('csv', new File([csv], 'expenses.csv', { type: 'text/csv' }))
  for (const [name, f] of Object.entries(files)) {
    form.append('attachments', new File([f.bytes], name, { type: f.type }))
  }
  const { origin, appId } = INTERFACES.portal
  const token = crypto.randomUUID()
  const res = await app.request('/api/ledger-adjustments/expense-bulk', {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-App-Id': appId,
      'X-CSRF-Token': token,
      Cookie: `${cookie}; csrf_${appId}=${token}`,
    },
    body: form,
  })
  return { status: res.status, json: (await res.json()) as ImportAnswer }
}

/** Remove what this file created: the expenses (marked by their description) and any entry posted for them. */
async function sweep() {
  const ids = (
    await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(ilike(expenses.description, `%${TAG}%`))
  ).map((r) => r.id)
  if (ids.length === 0) return
  const entries = (
    await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(eq(journalEntries.sourceDocType, 'expense'), inArray(journalEntries.sourceDocId, ids))
      )
  ).map((r) => r.id)
  if (entries.length > 0) {
    await db.delete(journalLines).where(inArray(journalLines.entryId, entries))
    await db
      .update(journalEntries)
      .set({ reversesEntryId: null })
      .where(inArray(journalEntries.reversesEntryId, entries))
    await db.delete(journalEntries).where(inArray(journalEntries.id, entries))
  }
  await db.delete(expenses).where(inArray(expenses.id, ids))
}

describe.skipIf(skip)('bulk expense receipts are named by the server and checked (review)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp
    const email = `bulk-admin-${Date.now()}@bulk.test`
    adminId = await createLoginUser(db, {
      email,
      name: 'Bulk admin',
      roleId: 'admin',
      baRole: 'admin',
    })
    cookie = await signInAs(app, email, 'portal')
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await sweep()
    await deleteLoginUsers(db, [adminId].filter(Boolean))
  })

  it('stores a genuine receipt under a readable name with random bits', async () => {
    stored.length = 0
    const res = await importBulk(
      [{ category: `${TAG} utilities`, paidTo: 'Electricity Co', attachment: 'r1.pdf' }],
      { 'r1.pdf': { bytes: PDF, type: 'application/pdf' } }
    )
    expect(res.status, JSON.stringify(res.json)).toBe(201)
    expect(stored).toHaveLength(1)
    expect(stored[0].category).toBe('system_docs')
    expect(stored[0].contentType).toBe('application/pdf')
    expect(stored[0].size).toBe(PDF.length)
    expect(stored[0].key).toMatch(
      /^expenses\/2026\/OCTOBER\/it_bulk_\d+_utilities_electricity_co_15th_october_2026-[0-9a-f]{16}\.pdf$/
    )
  })

  it('gives two receipts for the same category on the same day two different objects', async () => {
    stored.length = 0
    const res = await importBulk(
      [
        { category: `${TAG} fuel`, attachment: 'a.pdf' },
        { category: `${TAG} fuel`, attachment: 'b.pdf' },
      ],
      {
        'a.pdf': { bytes: PDF, type: 'application/pdf' },
        'b.pdf': { bytes: PDF, type: 'application/pdf' },
      }
    )
    expect(res.status, JSON.stringify(res.json)).toBe(201)
    expect(stored).toHaveLength(2)
    expect(stored[0].key).not.toBe(stored[1].key)
  })

  it('turns a category or payee that tries to be a path into a harmless label', async () => {
    stored.length = 0
    const res = await importBulk(
      [{ category: '../../patients/x', paidTo: '../y\\\\z', attachment: 'evil.pdf' }],
      { 'evil.pdf': { bytes: PDF, type: 'application/pdf' } }
    )
    expect(res.status, JSON.stringify(res.json)).toBe(201)
    expect(stored).toHaveLength(1)
    expect(stored[0].key).not.toContain('..')
    expect(stored[0].key.split('/')).toHaveLength(4) // expenses / year / MONTH / file
  })

  it('does not store a receipt that is not what it says, and says which row', async () => {
    stored.length = 0
    const res = await importBulk([{ category: `${TAG} fake`, attachment: 'page.pdf' }], {
      'page.pdf': { bytes: HTML, type: 'application/pdf' },
    })
    expect(res.status, JSON.stringify(res.json)).toBe(201) // the expense itself is still imported
    expect(stored).toHaveLength(0)
    const errors = res.json.data?.errors ?? []
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/Row 2/)
    expect(errors[0]).toMatch(/page\.pdf/)
  })

  it('does not store a file type a receipt cannot be', async () => {
    stored.length = 0
    const res = await importBulk([{ category: `${TAG} script`, attachment: 'run.exe' }], {
      'run.exe': { bytes: Buffer.from('MZ'), type: 'application/octet-stream' },
    })
    expect(res.status, JSON.stringify(res.json)).toBe(201)
    expect(stored).toHaveLength(0)
    expect(res.json.data?.errors?.[0]).toMatch(/run\.exe/)
  })

  it('imports the expense without an attachment when a receipt is refused', async () => {
    stored.length = 0
    const category = `${TAG} kept`
    const res = await importBulk([{ category, attachment: 'page.pdf' }], {
      'page.pdf': { bytes: HTML, type: 'application/pdf' },
    })
    expect(res.status, JSON.stringify(res.json)).toBe(201)
    const [row] = await db.select().from(expenses).where(eq(expenses.category, category))
    expect(row).toBeDefined()
    expect(row.attachmentUrl).toBeNull()
  })

  it('records the stored address on the expense when the receipt is accepted', async () => {
    stored.length = 0
    const category = `${TAG} recorded`
    const res = await importBulk([{ category, attachment: 'ok.pdf' }], {
      'ok.pdf': { bytes: PDF, type: 'application/pdf' },
    })
    expect(res.status, JSON.stringify(res.json)).toBe(201)
    const [row] = await db.select().from(expenses).where(eq(expenses.category, category))
    expect(row.attachmentUrl).toBe(`private-file://r2/${stored[0].key}#test`)
  })

  it('still imports the expense, with no attachment, when the named file was not sent', async () => {
    stored.length = 0
    const res = await importBulk([{ category: `${TAG} missing`, attachment: 'nothere.pdf' }], {})
    expect(res.status, JSON.stringify(res.json)).toBe(201)
    expect(stored).toHaveLength(0)
    expect(res.json.data?.errors?.[0]).toMatch(/not found/)
  })
})
