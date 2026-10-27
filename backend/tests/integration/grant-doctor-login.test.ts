/**
 * grantDoctorLogin — giving an EXISTING specialist a portal login.
 *
 * The defect: a login (auth user + credential + scope) was only ever minted by
 * the create flows. A specialist added as external — or as internal without a
 * password — could never get one, and editing them changed a label and nothing
 * else. These assert on the persisted rows and their LINKS, because a
 * half-granted login still "succeeds" in a naive implementation.
 *
 * Each case runs in `withRollback`, so the database is never mutated.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { account, specialists, staff, user, userScopes } from '../../src/db/schema'
import { GrantLoginError, grantDoctorLogin } from '../../src/lib/doctor-onboarding'
import { verifyPassword } from '../../src/lib/password'
import { anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

const PASSWORD = 'a-long-enough-password'
const addr = () => `grant-${randomUUID().slice(0, 8)}@it.local`

async function makeSpecialist(tx: DB, over: Partial<typeof specialists.$inferInsert> = {}) {
  const [row] = await tx
    .insert(specialists)
    .values({
      name: 'IT Dr Jemima',
      specialistType: 'external',
      contactEmail: 'ignored@it.local',
      contactPhone: '0240000099',
      defaultCommissionRate: 30,
      ...over,
    })
    .returning()
  return row
}

/** The code a refusal carries — the contract the route and UI branch on. */
async function refusalCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (err) {
    if (err instanceof GrantLoginError) return err.code
    throw err
  }
  return undefined
}

describe.skipIf(noDb)('grantDoctorLogin', () => {
  it('turns an external specialist into an internal doctor who can sign in', async () => {
    await withRollback(async (tx) => {
      const grantedById = await anyUserId(tx)
      const spec = await makeSpecialist(tx)
      const email = addr()

      const result = await grantDoctorLogin(tx, {
        specialistId: spec.id,
        email,
        password: PASSWORD,
        grantedById,
      })

      const after = await tx.query.specialists.findFirst({ where: eq(specialists.id, spec.id) })
      expect(after?.specialistType).toBe('internal')
      expect(after?.userId).toBe(result.userId)
      expect(after?.contactEmail).toBe(email)

      const u = await tx.query.user.findFirst({ where: eq(user.id, result.userId) })
      expect(u?.email).toBe(email)
      expect(u?.roleId).toBe('doctor')
      expect(u?.banned).toBe(false)

      // The credential is real: it verifies against the password we set.
      const acct = await tx.query.account.findFirst({ where: eq(account.userId, result.userId) })
      expect(acct?.providerId).toBe('credential')
      const hash = acct?.password
      if (!hash) throw new Error('the credential account has no password hash')
      expect(await verifyPassword({ hash, password: PASSWORD })).toBe(true)
      expect(await verifyPassword({ hash, password: 'wrong-password-123' })).toBe(false)
    })
  })

  // The portal's own intake makes an internal doctor WITHOUT an HR record, and a
  // staff row enrols someone in payroll and attendance. Letting a doctor sign in
  // must not quietly do that.
  it('does not enrol the specialist in HR — no staff record is created', async () => {
    await withRollback(async (tx) => {
      const spec = await makeSpecialist(tx)
      const before = await tx.select({ id: staff.id }).from(staff)

      const result = await grantDoctorLogin(tx, {
        specialistId: spec.id,
        email: addr(),
        password: PASSWORD,
        grantedById: await anyUserId(tx),
      })

      expect(result.staffRowId).toBeNull()
      const after = await tx.query.specialists.findFirst({ where: eq(specialists.id, spec.id) })
      expect(after?.staffId).toBeNull()
      expect(await tx.select({ id: staff.id }).from(staff)).toHaveLength(before.length)
    })
  })

  it('grants portal scope only — never the Team app', async () => {
    await withRollback(async (tx) => {
      const spec = await makeSpecialist(tx)
      const { userId } = await grantDoctorLogin(tx, {
        specialistId: spec.id,
        email: addr(),
        password: PASSWORD,
        grantedById: await anyUserId(tx),
      })
      const scopes = await tx.select().from(userScopes).where(eq(userScopes.userId, userId))
      expect(scopes.find((s) => s.interfaceScope === 'portal')?.granted).toBe(true)
      // user_scopes overrides the role's scopes; a pwa row would silently give
      // a doctor the Team app the doctor role deliberately lacks.
      expect(scopes.find((s) => s.interfaceScope === 'pwa')).toBeUndefined()
    })
  })

  it('can create the login with portal access switched off', async () => {
    await withRollback(async (tx) => {
      const spec = await makeSpecialist(tx)
      const { userId } = await grantDoctorLogin(tx, {
        specialistId: spec.id,
        email: addr(),
        password: PASSWORD,
        portalAccess: false,
        grantedById: await anyUserId(tx),
      })
      const scopes = await tx.select().from(userScopes).where(eq(userScopes.userId, userId))
      expect(scopes.find((s) => s.interfaceScope === 'portal')?.granted).toBe(false)
    })
  })

  // Better Auth looks users up by `email.toLowerCase()`: an account stored with
  // capitals can never sign in. The login must be created in the form it will
  // be looked up in.
  it('stores the email lowercased so sign-in can find it', async () => {
    await withRollback(async (tx) => {
      const spec = await makeSpecialist(tx)
      const { userId } = await grantDoctorLogin(tx, {
        specialistId: spec.id,
        email: `  Grant-${randomUUID().slice(0, 6)}@It.Local  `,
        password: PASSWORD,
        grantedById: await anyUserId(tx),
      })
      const u = await tx.query.user.findFirst({ where: eq(user.id, userId) })
      expect(u?.email).toBe(u?.email.toLowerCase())
      expect(u?.email).toBe(u?.email.trim())
    })
  })

  it('links the login to an existing employment record instead of creating one', async () => {
    await withRollback(async (tx) => {
      // HR onboarding without a password: internal + staff row, but no login.
      const spec = await makeSpecialist(tx, { specialistType: 'internal' })
      const [existing] = await tx
        .insert(staff)
        .values({
          staffId: `FDM-IT${randomUUID().slice(0, 6)}`,
          fullName: spec.name,
          specialistId: spec.id,
          staffType: 'internal',
          isExternal: false,
          status: 'active',
          employmentType: 'permanent',
        })
        .returning()
      await tx.update(specialists).set({ staffId: existing.id }).where(eq(specialists.id, spec.id))

      const result = await grantDoctorLogin(tx, {
        specialistId: spec.id,
        email: addr(),
        password: PASSWORD,
        grantedById: await anyUserId(tx),
      })

      expect(result.staffRowId).toBe(existing.id)
      const rows = await tx.select().from(staff).where(eq(staff.specialistId, spec.id))
      expect(rows).toHaveLength(1)
      expect(rows[0].userId).toBe(result.userId)
    })
  })

  // ── Refusals — each must leave the database exactly as it found it ────────

  it('refuses a specialist who already has a login', async () => {
    await withRollback(async (tx) => {
      const grantedById = await anyUserId(tx)
      const spec = await makeSpecialist(tx)
      await grantDoctorLogin(tx, {
        specialistId: spec.id,
        email: addr(),
        password: PASSWORD,
        grantedById,
      })
      const code = await refusalCode(
        grantDoctorLogin(tx, {
          specialistId: spec.id,
          email: addr(),
          password: PASSWORD,
          grantedById,
        })
      )
      expect(code).toBe('ALREADY_HAS_LOGIN')
    })
  })

  it('refuses an email that already has a login — case-insensitively — and writes nothing', async () => {
    await withRollback(async (tx) => {
      const grantedById = await anyUserId(tx)
      const taken = await tx.query.user.findFirst({ columns: { email: true } })
      if (!taken) throw new Error('integration fixtures need at least one row in "user"')
      const spec = await makeSpecialist(tx)

      const code = await refusalCode(
        grantDoctorLogin(tx, {
          specialistId: spec.id,
          email: taken.email.toUpperCase(),
          password: PASSWORD,
          grantedById,
        })
      )
      expect(code).toBe('EMAIL_TAKEN')

      // Nothing half-written: still external, no login, no employment record.
      const after = await tx.query.specialists.findFirst({ where: eq(specialists.id, spec.id) })
      expect(after?.specialistType).toBe('external')
      expect(after?.userId).toBeNull()
      expect(after?.staffId).toBeNull()
      expect(await tx.select().from(staff).where(eq(staff.specialistId, spec.id))).toHaveLength(0)
    })
  })

  // The old create paths stored the email verbatim, so legacy rows can hold
  // capitals. Lowercasing only the INPUT would let a second account through for
  // the same address; the comparison has to fold the stored side too.
  it('refuses an email held by a legacy mixed-case account', async () => {
    await withRollback(async (tx) => {
      const grantedById = await anyUserId(tx)
      const local = randomUUID().slice(0, 8)
      await tx.insert(user).values({
        id: randomUUID(),
        name: 'IT Legacy',
        email: `Legacy-${local}@It.Local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const spec = await makeSpecialist(tx)

      const code = await refusalCode(
        grantDoctorLogin(tx, {
          specialistId: spec.id,
          email: `legacy-${local}@it.local`,
          password: PASSWORD,
          grantedById,
        })
      )
      expect(code).toBe('EMAIL_TAKEN')
    })
  })

  it('refuses an inactive specialist', async () => {
    await withRollback(async (tx) => {
      const spec = await makeSpecialist(tx, { isActive: false })
      const code = await refusalCode(
        grantDoctorLogin(tx, {
          specialistId: spec.id,
          email: addr(),
          password: PASSWORD,
          grantedById: await anyUserId(tx),
        })
      )
      expect(code).toBe('INACTIVE')
    })
  })

  it('refuses when the employment record is already tied to a different login', async () => {
    await withRollback(async (tx) => {
      const grantedById = await anyUserId(tx)
      const spec = await makeSpecialist(tx, { specialistType: 'internal' })
      const [row] = await tx
        .insert(staff)
        .values({
          staffId: `FDM-IT${randomUUID().slice(0, 6)}`,
          fullName: spec.name,
          specialistId: spec.id,
          userId: grantedById,
          staffType: 'internal',
          isExternal: false,
          status: 'active',
          employmentType: 'permanent',
        })
        .returning()
      await tx.update(specialists).set({ staffId: row.id }).where(eq(specialists.id, spec.id))

      const code = await refusalCode(
        grantDoctorLogin(tx, {
          specialistId: spec.id,
          email: addr(),
          password: PASSWORD,
          grantedById,
        })
      )
      expect(code).toBe('STAFF_ALREADY_LINKED')
    })
  })

  it('reports an unknown specialist as not found', async () => {
    await withRollback(async (tx) => {
      const code = await refusalCode(
        grantDoctorLogin(tx, {
          specialistId: randomUUID(),
          email: addr(),
          password: PASSWORD,
          grantedById: await anyUserId(tx),
        })
      )
      expect(code).toBe('NOT_FOUND')
    })
  })
})
