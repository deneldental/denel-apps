// Self-heal: ensures the doctors/specialists/gcal-links schema matches what
// the post-unification code expects. Idempotent — re-runs are harmless.
//
// Why this exists: migrations 0047 + 0048 added new columns/constraints, but
// in dev we've seen them applied partially (or via db:push that skipped some
// statements). Rather than asking the dev to manually recover, this self-heal
// brings the schema up to the expected state on every startup.
//
// Every statement is wrapped in its own try/catch so a single missing table
// (e.g. GCal not yet provisioned in some envs) doesn't poison the rest. Each
// statement is also guarded with IF EXISTS / IF NOT EXISTS so re-runs are
// truly no-ops.

import { sql } from 'drizzle-orm'
import type { getDb } from '../db'
import { logger } from './logger'

type Db = ReturnType<typeof getDb>

/** Run a single SQL statement, log + swallow per-statement failures so the
 *  remaining statements in the heal still execute. */
async function runStep(db: Db, label: string, stmt: ReturnType<typeof sql>): Promise<void> {
  try {
    await db.execute(stmt)
  } catch (err) {
    logger.warn({ err, step: label }, `[doctor-specialist heal] step "${label}" skipped`)
  }
}

export async function ensureDoctorSpecialistSchema(db: Db): Promise<void> {
  // 1. specialists: add specialistType (default 'external'), user_id link.
  await runStep(
    db,
    'specialists.specialist_type',
    sql`ALTER TABLE specialists ADD COLUMN IF NOT EXISTS specialist_type text NOT NULL DEFAULT 'external'`
  )
  await runStep(
    db,
    'specialists.user_id',
    sql`ALTER TABLE specialists ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"(id) ON DELETE SET NULL`
  )
  await runStep(
    db,
    'specialists_user_id_unique',
    sql`CREATE UNIQUE INDEX IF NOT EXISTS specialists_user_id_unique ON specialists (user_id) WHERE user_id IS NOT NULL`
  )
  await runStep(
    db,
    'specialists.gcal_calendar_id',
    sql`ALTER TABLE specialists ADD COLUMN IF NOT EXISTS gcal_calendar_id text`
  )

  // 2. doctors: userId nullable + specialistId FK to specialists.
  await runStep(
    db,
    'doctors.userId DROP NOT NULL',
    sql`ALTER TABLE doctors ALTER COLUMN "userId" DROP NOT NULL`
  )
  await runStep(
    db,
    'doctors.specialistId',
    sql`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS "specialistId" uuid REFERENCES specialists(id) ON DELETE RESTRICT`
  )
  await runStep(
    db,
    'doctors_specialist_id_unique',
    sql`CREATE UNIQUE INDEX IF NOT EXISTS doctors_specialist_id_unique ON doctors ("specialistId") WHERE "specialistId" IS NOT NULL`
  )

  // 3. doctors: mutex CHECK so exactly one source is set. Drop-then-add so
  // we don't fail if a previous definition exists with the same name. Skipped
  // if there are existing doctors rows that would violate the constraint
  // (those get fixed up by the backfill below — then we'll re-add on next boot).
  await runStep(
    db,
    'doctors_source_xor (drop)',
    sql`ALTER TABLE doctors DROP CONSTRAINT IF EXISTS doctors_source_xor`
  )
  await runStep(
    db,
    'doctors_source_xor (add)',
    sql`ALTER TABLE doctors ADD CONSTRAINT doctors_source_xor CHECK ((("userId" IS NOT NULL)::int + ("specialistId" IS NOT NULL)::int) = 1)`
  )

  // 4. google_calendar_event_links: userId nullable (for SA-mode events on
  // shared calendar for specialists with no linked user). Skipped if the
  // table doesn't exist yet (some envs haven't enabled GCal at all).
  await runStep(
    db,
    'gcal_event_links.user_id DROP NOT NULL',
    sql`ALTER TABLE google_calendar_event_links ALTER COLUMN user_id DROP NOT NULL`
  )

  // 5. Backfill: every staff user with roleId='doctor' becomes an internal
  // specialist (matches migration 0048's data step). NOT EXISTS guard so
  // re-runs don't duplicate.
  await runStep(
    db,
    'backfill specialists from doctor users',
    sql`
      INSERT INTO specialists (
        id, name, contact_email, contact_phone,
        default_commission_rate, withholding_tax_rate,
        is_active, specialist_type, user_id
      )
      SELECT
        gen_random_uuid(),
        COALESCE(u.name, 'Doctor'),
        u.email,
        u.phone,
        0,
        0,
        true,
        'internal',
        u.id
      FROM "user" u
      WHERE u."roleId" = 'doctor'
        AND NOT EXISTS (SELECT 1 FROM specialists s WHERE s.user_id = u.id)
    `
  )

  // 5b. Wider backfill: any user that's been ASSIGNED as a doctor on a
  // doctors row (regardless of roleId) also needs a specialist record, or
  // their appointments fall through to the SA's shared calendar in
  // resolveSyncContext. This catches non-'doctor'-role users that were
  // historically wired up via doctors.userId (e.g. admins moonlighting as
  // providers in dev data). NOT EXISTS guard keeps it idempotent.
  await runStep(
    db,
    'backfill specialists from doctor.userId references',
    sql`
      INSERT INTO specialists (
        id, name, contact_email, contact_phone,
        default_commission_rate, withholding_tax_rate,
        is_active, specialist_type, user_id
      )
      SELECT DISTINCT
        gen_random_uuid(),
        COALESCE(u.name, 'Doctor'),
        u.email,
        u.phone,
        0,
        0,
        true,
        'internal',
        u.id
      FROM doctors d
      JOIN "user" u ON u.id = d."userId"
      WHERE d."userId" IS NOT NULL
        AND d."specialistId" IS NULL
        AND NOT EXISTS (SELECT 1 FROM specialists s WHERE s.user_id = u.id)
    `
  )

  // 6. Backfill: rewire doctors rows from userId to specialistId for migrated
  // internal specialists. Only touches rows that haven't been migrated yet.
  // Runs AFTER step 5b so the wider backfill has populated specialists for
  // any non-'doctor'-role users assigned as providers.
  await runStep(
    db,
    'rewire doctors → specialists',
    sql`
      UPDATE doctors d
      SET "specialistId" = s.id, "userId" = NULL, "updatedAt" = now()
      FROM specialists s
      WHERE d."userId" IS NOT NULL
        AND s.user_id = d."userId"
        AND d."specialistId" IS NULL
    `
  )

  // 7. service_doctors: M2M junction with per-link commission. Created here
  // (not via formal migration) so dev DBs pick it up on next boot without a
  // manual db:push step.
  await runStep(
    db,
    'service_doctors table',
    sql`
      CREATE TABLE IF NOT EXISTS service_doctors (
        service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        doctor_id uuid NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
        commission_rate numeric(5,2),
        withholding_tax_rate numeric(5,2),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        PRIMARY KEY (service_id, doctor_id)
      )
    `
  )
  await runStep(
    db,
    'service_doctors.no_commission',
    sql`ALTER TABLE service_doctors ADD COLUMN IF NOT EXISTS no_commission boolean NOT NULL DEFAULT false`
  )
  await runStep(
    db,
    'service_doctors_doctor_idx',
    sql`CREATE INDEX IF NOT EXISTS service_doctors_doctor_idx ON service_doctors (doctor_id)`
  )

  // 8. payments.payment_group_id — groups split-payment siblings so one
  // receipt can show "Method 1 / Method 2 / …" with each amount.
  await runStep(
    db,
    'payments.payment_group_id',
    sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_group_id uuid`
  )
  await runStep(
    db,
    'payments_payment_group_id_idx',
    sql`CREATE INDEX IF NOT EXISTS payments_payment_group_id_idx ON payments (payment_group_id) WHERE payment_group_id IS NOT NULL`
  )

  // 9. Backfill: any plan whose master invoice has null planId (Phase-5 plans
  // created BEFORE the createPlan back-reference fix). Without this the
  // plan→invoices relation returns an empty array and the progress UI shows
  // 0% paid even after real payments. Idempotent.
  await runStep(
    db,
    'backfill invoices.planId from plan.invoice_id',
    sql`
      UPDATE invoices i
      SET "planId" = pp.id, "updatedAt" = now()
      FROM payment_plans pp
      WHERE pp.invoice_id = i.id
        AND i."planId" IS NULL
    `
  )

  // (A former step 10 re-created `payments_method_check` here with a fixed
  // 8-slug list on every boot — silently undoing migration 0214, which dropped
  // it because payment methods are admin-configurable. Removed; 0221 drops the
  // constraint again for databases that booted in between.)
}
