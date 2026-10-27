import { sql } from 'drizzle-orm'
import type { DB } from '../db'
import { staff } from '../db/schema'

/** The transaction handle `db.transaction()` hands its callback. */
type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

/**
 * The next Staff ID — FDM-S0001, FDM-S0002, … — for a person being created inside transaction `tx`.
 *
 * Three routes create staff (HR "Add staff", approving a self-registration, onboarding a doctor)
 * and each had its own copy of "highest number plus one". Two things were wrong with the copies:
 *
 *   - They read the digits of EVERY staff ID and cast them to an integer, so a single ID with no
 *     digits, or with more than nine (a hand-typed or imported one), made the query fail — and
 *     with it every creation, for everyone, until that row was fixed. This counts only the IDs it
 *     hands out itself (`FDM-S` and up to nine digits).
 *   - Doing it inside a transaction does not stop two requests from reading the same highest
 *     number: both got FDM-S0042 and the second failed on the unique username ("Key
 *     (username)=(fdm-s0042) already exists") for the person who clicked second. The advisory lock
 *     makes the second request wait until the first has committed, then read its number.
 *
 * The lock is held until the transaction ends, so call this first thing inside it. It takes a
 * transaction handle, not the database: a plain connection would release the lock at once.
 */
export async function nextStaffId(tx: Tx): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('staff-id'))`)
  const [result] = await tx
    .select({
      maxNum: sql<number | null>`max(substring("staffId" from '^FDM-S([0-9]{1,9})$')::int)`,
    })
    .from(staff)
  const next = (result?.maxNum ?? 0) + 1
  return `FDM-S${String(next).padStart(4, '0')}`
}
