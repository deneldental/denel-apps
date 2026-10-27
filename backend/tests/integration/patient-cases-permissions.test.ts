/**
 * F04 — a doctor can open a patient case; archiving stays restricted (decision D3).
 * `POST /api/patient-cases` and `DELETE /api/patient-cases/:id`.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 4).
 *
 * The Clinical page showed every doctor a "New case" button, and the server answered
 * it with 403: case creation needed `patients:create` (registering a patient), which
 * the doctor does not hold. Opening a case is clinical work, so it now needs
 * `medical_records:create`. Archiving a case keeps `patients:delete`, which neither
 * the doctor nor the receptionist holds.
 *
 * Real stack: the real app, real signed-in roles, a real database.
 *
 * ── Safety ── commits fixtures; local Postgres only. The patient is named `IT …`
 * so `sweepLeakedFixtures` removes it.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/patient-cases-permissions.test.ts
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { DB } from '../../src/db'
import { patientCases, patients } from '../../src/db/schema'
import { sweepLeakedFixtures } from './_fixtures'
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
const db = localDb() as DB

const TAG = `cases-${Date.now()}`

type Role = 'doctor' | 'receptionist' | 'staff' | 'admin'
const ROLE_ID: Record<Role, string> = {
  doctor: 'doctor',
  receptionist: 'receptionist',
  staff: 'staff',
  admin: 'admin',
}
const IFACE: Record<Role, Interface> = {
  doctor: 'portal',
  receptionist: 'portal',
  staff: 'pwa', // staff only sign in to the Team app
  admin: 'portal',
}

let app: TestApp
const userIds: string[] = []
const cookies = {} as Record<Role, string>
let patientId: string
const caseIds: string[] = []

const call = (role: Role, method: string, path: string, body?: unknown) =>
  callAs(app, IFACE[role], cookies[role], method, path, body)

const caseOf = async (id: string) => {
  const [c] = await db.select().from(patientCases).where(eq(patientCases.id, id))
  return c
}

describe.skipIf(skip)('patient cases: who may open and archive one (D3)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp
    await sweepLeakedFixtures()

    for (const role of Object.keys(ROLE_ID) as Role[]) {
      const email = `${role}-${TAG}@cases.test`
      userIds.push(
        await createLoginUser(db, {
          email,
          name: `Cases ${role} ${TAG}`,
          roleId: ROLE_ID[role],
          baRole: role === 'admin' ? 'admin' : undefined,
        })
      )
      cookies[role] = await signInAs(app, email, IFACE[role])
    }

    const [p] = await db
      .insert(patients)
      .values({
        name: `IT Cases ${TAG}`,
        dob: new Date('1990-01-01'),
        gender: 'other',
        phone: '0240000061',
      })
      .returning({ id: patients.id })
    patientId = p.id
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (skip) return
    if (caseIds.length) await db.delete(patientCases).where(inArray(patientCases.id, caseIds))
    await sweepLeakedFixtures()
    await deleteLoginUsers(db, userIds)
  })

  const open = async (role: Role) => {
    const res = await call(role, 'POST', '/api/patient-cases', { patientId })
    const id = (res.json?.data as { id?: string } | undefined)?.id
    if (id) caseIds.push(id)
    return { ...res, id }
  }

  it('a doctor can open a case (medical_records:create)', async () => {
    const { status, json, id } = await open('doctor')
    expect(status, JSON.stringify(json)).toBe(201)
    expect(id).toBeTruthy()
    expect(await caseOf(id as string)).toMatchObject({
      patientId,
      status: 'open',
    })
    // The case is recorded as the doctor's, not someone else's.
    expect((await caseOf(id as string)).createdById).toBeTruthy()
  })

  it('reception can still open a case', async () => {
    const { status, json } = await open('receptionist')
    expect(status, JSON.stringify(json)).toBe(201)
  })

  it('an admin can open a case', async () => {
    const { status, json } = await open('admin')
    expect(status, JSON.stringify(json)).toBe(201)
  })

  it('staff, who hold no clinical permission, cannot', async () => {
    const before = caseIds.length
    const { status } = await open('staff')
    expect(status).toBe(403)
    expect(caseIds).toHaveLength(before)
  })

  it('a doctor still must name a patient', async () => {
    // The route is reached (not blocked by permission), so the 400 is the route's own.
    const res = await call('doctor', 'POST', '/api/patient-cases', {})
    expect(res.status).toBe(400)
  })

  describe('archiving stays restricted to patients:delete', () => {
    let target: string

    beforeAll(async () => {
      target = (await open('admin')).id as string
    })

    it('a doctor cannot archive a case, and it stays open', async () => {
      const res = await call('doctor', 'DELETE', `/api/patient-cases/${target}`)
      expect(res.status).toBe(403)
      expect((await caseOf(target)).deletedAt).toBeNull()
    })

    it('reception cannot archive a case either', async () => {
      const res = await call('receptionist', 'DELETE', `/api/patient-cases/${target}`)
      expect(res.status).toBe(403)
      expect((await caseOf(target)).deletedAt).toBeNull()
    })

    it('an admin can', async () => {
      const res = await call('admin', 'DELETE', `/api/patient-cases/${target}`)
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      expect((await caseOf(target)).deletedAt).not.toBeNull()
    })
  })
})
