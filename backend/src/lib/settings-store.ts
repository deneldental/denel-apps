// Typed accessors for settings backed by both the in-memory cache (fast read)
// and the `clinic_settings` table (durable, survives restart).
//
// Why both: the cache was the original store but loses values on every restart.
// We now persist to DB on write and lazy-populate the cache on read miss.

import {
  type CrmAutomationPolicies,
  normalizeCrmPolicies,
  normalizePettyCashPolicy,
  type PettyCashPolicy,
} from '@denel/utils'
import { eq } from 'drizzle-orm'
import type { getDb } from '../db'
import { clinicSettings } from '../db/schema'
import { cache } from './cache'

export const LOW_STOCK_THRESHOLD_KEY = 'settings:low_stock_alert_threshold'
export const DEFAULT_LOW_STOCK_THRESHOLD = 10
const CACHE_TTL_SECONDS = 365 * 24 * 60 * 60

// admin-v1 §13.5 — per-unit comms cost (GHS). Admin-configurable via the same
// clinic_settings KV used for the low-stock threshold. Defaults mirror typical
// Ghana gateway pricing: ~4 pesewas per SMS page (Hubtel bulk), and a nominal
// fraction-of-a-pesewa for email (Resend is effectively free, but we still book
// a non-zero figure so outreach spend is visible). These are DR 5400 Marketing.
export const SMS_COST_PER_UNIT_KEY = 'settings:sms_cost_per_unit'
export const EMAIL_COST_PER_UNIT_KEY = 'settings:email_cost_per_unit'
export const DEFAULT_SMS_COST_PER_UNIT = 0.04
export const DEFAULT_EMAIL_COST_PER_UNIT = 0.001

type Db = ReturnType<typeof getDb>

async function readDbNumber(db: Db, key: string): Promise<number | null> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, key))
    .limit(1)
  if (!row) return null
  const raw = row.value
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw
  if (typeof raw === 'string') {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return null
}

export async function getLowStockThreshold(db: Db): Promise<number> {
  const cached = cache.get<number>(LOW_STOCK_THRESHOLD_KEY)
  if (typeof cached === 'number' && cached >= 0) return cached

  const fromDb = await readDbNumber(db, LOW_STOCK_THRESHOLD_KEY)
  if (fromDb !== null) {
    cache.set(LOW_STOCK_THRESHOLD_KEY, fromDb, CACHE_TTL_SECONDS)
    return fromDb
  }

  return DEFAULT_LOW_STOCK_THRESHOLD
}

export async function setLowStockThreshold(
  db: Db,
  value: number,
  updatedById: string
): Promise<number> {
  const n = Number(value)
  // Last line of defence behind the route's zod check: NaN used to be stored
  // as JSON null (and cached as NaN) and a negative clamped to 0, both with
  // `success: true`.
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('low-stock threshold must be a finite, non-negative number')
  }
  const sanitized = Math.floor(n)
  await db
    .insert(clinicSettings)
    .values({ key: LOW_STOCK_THRESHOLD_KEY, value: sanitized, updatedById })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value: sanitized, updatedById, updatedAt: new Date() },
    })
  cache.set(LOW_STOCK_THRESHOLD_KEY, sanitized, CACHE_TTL_SECONDS)
  return sanitized
}

// ── Products / inventory locks ───────────────────────────────────────────────
//
// Persisted exactly like the low-stock threshold: DB on write, lazy cache on
// read. They used to live only in the process cache, so every restart — each
// deploy runs `docker compose up -d` — silently unlocked both, and
// `canPerformAction` let non-admins write again (settings-domain-audit B4).

export const PRODUCTS_LOCK_KEY = 'settings:products:locked'
export const INVENTORY_LOCK_KEY = 'settings:inventory:locked'
export type LockTarget = 'products' | 'inventory'
const LOCK_KEYS: Record<LockTarget, string> = {
  products: PRODUCTS_LOCK_KEY,
  inventory: INVENTORY_LOCK_KEY,
}

async function readDbBoolean(db: Db, key: string): Promise<boolean | null> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, key))
    .limit(1)
  return typeof row?.value === 'boolean' ? row.value : null
}

/** Whether `target` is locked to admins. Unlocked until an admin locks it. */
export async function getLock(db: Db, target: LockTarget): Promise<boolean> {
  const key = LOCK_KEYS[target]
  const cached = cache.get<boolean>(key)
  if (typeof cached === 'boolean') return cached

  const fromDb = await readDbBoolean(db, key)
  if (fromDb !== null) {
    cache.set(key, fromDb, CACHE_TTL_SECONDS)
    return fromDb
  }
  return false
}

/** Lock or unlock `target`. Admin-only call site. */
export async function setLock(
  db: Db,
  target: LockTarget,
  locked: boolean,
  updatedById: string
): Promise<boolean> {
  const key = LOCK_KEYS[target]
  await db
    .insert(clinicSettings)
    .values({ key, value: locked, updatedById })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value: locked, updatedById, updatedAt: new Date() },
    })
  cache.set(key, locked, CACHE_TTL_SECONDS)
  return locked
}

// ── §13.5 — SMS/email per-unit cost ──────────────────────────────────────────
//
// Read DB-first (NOT cache-first like the low-stock threshold): comms rates are
// read at most once per send (a rare event), so the cache buys nothing, and a
// DB-first read keeps the figure correct the instant an admin changes it — and
// keeps the rollback-based integration tests deterministic (a sandboxed write is
// never leaked into the process cache). A non-negative float is accepted.

async function getCommsRate(db: Db, key: string, fallback: number): Promise<number> {
  const fromDb = await readDbNumber(db, key)
  return fromDb !== null ? fromDb : fallback
}

/** Per-SMS-unit cost in GHS (admin-configurable; defaults to 0.04). */
export function getSmsCostPerUnit(db: Db): Promise<number> {
  return getCommsRate(db, SMS_COST_PER_UNIT_KEY, DEFAULT_SMS_COST_PER_UNIT)
}

/** Per-email cost in GHS (admin-configurable; defaults to 0.001). */
export function getEmailCostPerUnit(db: Db): Promise<number> {
  return getCommsRate(db, EMAIL_COST_PER_UNIT_KEY, DEFAULT_EMAIL_COST_PER_UNIT)
}

async function setCommsRate(
  db: Db,
  key: string,
  value: number,
  updatedById: string
): Promise<number> {
  const sanitized = Math.max(0, Number(value))
  if (!Number.isFinite(sanitized))
    throw new Error('comms cost must be a finite, non-negative number')
  await db
    .insert(clinicSettings)
    .values({ key, value: sanitized, updatedById })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value: sanitized, updatedById, updatedAt: new Date() },
    })
  return sanitized
}

/** Set the per-SMS-unit cost (GHS). Admin-only call site. */
export function setSmsCostPerUnit(db: Db, value: number, updatedById: string): Promise<number> {
  return setCommsRate(db, SMS_COST_PER_UNIT_KEY, value, updatedById)
}

/** Set the per-email cost (GHS). Admin-only call site. */
export function setEmailCostPerUnit(db: Db, value: number, updatedById: string): Promise<number> {
  return setCommsRate(db, EMAIL_COST_PER_UNIT_KEY, value, updatedById)
}

// ─── Audit-log retention (`security:audit_retention`) ────────────────────────
// Written by Settings → Security & Kiosk; read by the monthly audit-retention
// cron (settings-domain-audit S5). No cache — the job runs once a month.

export const AUDIT_RETENTION_KEY = 'security:audit_retention'
export const DEFAULT_AUDIT_RETENTION_DAYS = 365

const RETENTION_PERIOD_DAYS = {
  '90_days': 90,
  '180_days': 180,
  '1_year': 365,
  indefinite: null,
} as const satisfies Record<string, number | null>

function isRetentionPeriod(value: unknown): value is keyof typeof RETENTION_PERIOD_DAYS {
  return typeof value === 'string' && Object.hasOwn(RETENTION_PERIOD_DAYS, value)
}

/**
 * Days to keep `audit_logs`, or `null` when the clinic chose "indefinite"
 * (never purge). A missing or malformed row falls back to the 365-day default.
 */
export async function getAuditRetentionDays(db: Db): Promise<number | null> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, AUDIT_RETENTION_KEY))
    .limit(1)
  const value: unknown = row?.value
  const period =
    typeof value === 'object' && value !== null
      ? (value as { retentionPeriod?: unknown }).retentionPeriod
      : undefined
  return isRetentionPeriod(period) ? RETENTION_PERIOD_DAYS[period] : DEFAULT_AUDIT_RETENTION_DAYS
}

// ─── Inventory policies (`inventory:policies`) ───────────────────────────────
// Written by Settings → Inventory → Store Policies; read by the inventory
// ledger (valuation method) and served to the portal (expiry windows, reason
// codes). Defaults mirror the portal's (settings-domain-audit S5-B).

export const INVENTORY_POLICIES_KEY = 'inventory:policies'
export type ValuationMethod = 'fifo' | 'weighted_average'
export interface InventoryPolicies {
  expiryWarningDays: number
  criticalExpiryDays: number
  valuationMethod: ValuationMethod
  adjustmentReasons: string[]
}
export const DEFAULT_INVENTORY_POLICIES: InventoryPolicies = {
  expiryWarningDays: 90,
  criticalExpiryDays: 30,
  valuationMethod: 'fifo',
  adjustmentReasons: [
    'Count Variance',
    'Expired Stock',
    'Damaged / Broken',
    'Internal Clinic Use',
    'Donation',
  ],
}

function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

/** Field by field: a missing or malformed field falls back to its default. */
export function normalizeInventoryPolicies(raw: unknown): InventoryPolicies {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const reasons = Array.isArray(r.adjustmentReasons)
    ? r.adjustmentReasons
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => x.trim())
    : []
  return {
    expiryWarningDays: nonNegativeInt(
      r.expiryWarningDays,
      DEFAULT_INVENTORY_POLICIES.expiryWarningDays
    ),
    criticalExpiryDays: nonNegativeInt(
      r.criticalExpiryDays,
      DEFAULT_INVENTORY_POLICIES.criticalExpiryDays
    ),
    valuationMethod: r.valuationMethod === 'weighted_average' ? 'weighted_average' : 'fifo',
    adjustmentReasons: reasons.length > 0 ? reasons : DEFAULT_INVENTORY_POLICIES.adjustmentReasons,
  }
}

export async function getInventoryPolicies(db: Db): Promise<InventoryPolicies> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, INVENTORY_POLICIES_KEY))
    .limit(1)
  return normalizeInventoryPolicies(row?.value)
}

// ─── Clinical charting preferences (`clinical:charting_preferences`) ─────────
// Written by Settings → Clinical → Charting Preferences. The backend reads one
// field: the final fallback for a lab case's turnaround (settings-domain-audit
// S5-B). Notation, prescription days and perio thresholds are portal-side.

export const CLINICAL_CHARTING_KEY = 'clinical:charting_preferences'
export const DEFAULT_LAB_TURNAROUND_DAYS = 7

export async function getDefaultLabTurnaroundDays(db: Db): Promise<number> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, CLINICAL_CHARTING_KEY))
    .limit(1)
  const value: unknown = row?.value
  const days =
    typeof value === 'object' && value !== null
      ? (value as { defaultLabTurnaroundDays?: unknown }).defaultLabTurnaroundDays
      : undefined
  return typeof days === 'number' && Number.isFinite(days) && days > 0
    ? Math.floor(days)
    : DEFAULT_LAB_TURNAROUND_DAYS
}

// ─── CRM automation policies (`crm:automation_policies`) ─────────────────────
// Written by Settings → CRM → Automations; read by the CRM auto-queue
// (birthday segment), the 15-minute scheduler (quiet hours) and, on save, the
// reminder-stage sync (settings-domain-audit S5-B). No cache — the readers run
// on a schedule, not per request.

export const CRM_POLICIES_KEY = 'crm:automation_policies'

export async function getCrmPolicies(db: Db): Promise<CrmAutomationPolicies> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, CRM_POLICIES_KEY))
    .limit(1)
  return normalizeCrmPolicies(row?.value)
}

// ─── Petty cash policy (`finance:petty_cash`) ────────────────────────────────
// Written by Settings → Finance → Petty Cash Policy (cedis); read by the
// expense create path (review gate, IOU cap) and the petty-cash balance
// (settings-domain-audit S5-B).

export const PETTY_CASH_POLICY_KEY = 'finance:petty_cash'

export async function getPettyCashPolicy(db: Db): Promise<PettyCashPolicy> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, PETTY_CASH_POLICY_KEY))
    .limit(1)
  return normalizePettyCashPolicy(row?.value)
}
