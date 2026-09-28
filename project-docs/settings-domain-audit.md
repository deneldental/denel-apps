# Settings Domain Audit & Remediation Plan

> **Status 2026-09-24 — every slice complete (S1–S6).** Closed: A1, A2, A3
> (by decision: ordinary KV keys stay `settings:update`, `pwa_enabled_modules`
> is admin-only, lookups/locks/export/import stay admin), A4, A5, B1–B11 (B11
> was found during S4), C, D1–D10, E. Nothing open. Keep the per-finding status lines
> (and this banner) as slices land, the way `auth-security-audit.md` does.
> Fix details are at the bottom.

**Date:** 2026-09-22/23 · **Scope:** the settings domain end to end —
`backend/src/routes/settings.ts`, `lib/settings-store.ts`,
`lib/settings-export.ts`, `routes/lookups.ts`, the dedicated routes each
settings section talks to, `db/schema/settings-lookup.ts`, the
`clinic_settings` KV table, all 35 `portals/src/features/settings/` section
components + pages/groups/actions/hooks, and every consumer of every KV key
across `backend/`, `portals/`, `hr/`, `team/`, `patient/`. `reports/` was
checked only for drift against the backend.

Every finding was read in source; the B1 crash was reproduced in Node. Line
numbers are as of the audit commit and will drift — search for the quoted
identifier if a reference lands wrong. The earlier
`lookups_audit_report.md` covers the lookup *inventory* and proposes a master
CSV; this audit covers behaviour, authorization and integration, and only
overlaps it at D2 (export coverage). Note that report's endpoint column has
drifted (`xray-types` is `/api/xrays/types`, app payment methods are
`/api/app-payment-methods`, HR lookups are managed in the HR app, not the
portal).

Related: `project-docs/denel-rebrand-plan.md` (current scope is `portals/`
only — slices S1–S4 below are mostly backend, so widening scope is a
deliberate decision, not an accident).

---

## Summary

The domain is not "perfectly built". Three problem classes:

1. **Authorization loopholes.** The generic `PUT /api/settings/kv/:key` has no
   key allowlist, so `settings:update` can overwrite encrypted integration
   secrets with plaintext the integration layer will accept (A1). Two lookup
   routes have no permission check on create/update at all (A2). Server-side
   "who may change settings" has three different answers while the UI has one
   (A3).
2. **Bugs.** The Currency section crashes while typing (B1); settings import
   500s on any cross-environment restore (B2); payslip PDFs read a branding key
   nothing writes (B3); the products/inventory locks evaporate on every deploy
   (B4); a failed load silently shows defaults that Save then persists (B5);
   several lookups can be hard-deleted or renamed while in use (B6, B7).
3. **Decorative settings.** Eight sections persist JSON that no code in any app
   reads, while their copy promises enforcement ("Policy changes immediately
   apply…", "enforcing auto-logout", "Drives scheduling and reminders") (C).

What is solid: the `SESSION_READABLE_KEYS` split and the `hr.` prefix show the
right instinct; CSRF + `X-App-Id` are centralised in the api client; the SSE
import path is careful (frame buffering, "no terminal event ⇒ unknown
result"); the lookup delete usage-check registry + 409 `LOOKUP_IN_USE` →
"Deactivate instead" is the best pattern in the domain; `useLookupAdmin`'s
prefix-key invalidation is the right design; module visibility is properly
shared off one query key; integration secrets are encrypted at rest.

---

## A. Authorization loopholes

### A1 — HIGH: `PUT /kv/:key` writes any key, including integration secrets
`backend/src/routes/settings.ts:224-254`. No key allowlist, no value schema.
`lib/integrations.ts:146-158` (`readKv`) accepts legacy plaintext rows, so a
holder of `settings:update` (bundle_settings_full — not admin) can PUT
plaintext JSON to `integration_r2` and point uploads at their own bucket, or
clobber `integration_upstash`, `integration_cron_engine.internalSecret`,
`integrations:google_oauth_config`, `pwa_enabled_modules`, `tax_rates`,
`treatment_gate.mode`. This collapses `settings:update` into
`integrations:update`, which `permissions.config.ts` seeds as separate grants.
The `hr.` prefix check at `:228-230` shows the intent; nothing else is scoped.

`GET /kv/:key` (`:205-221`) with `settings:read` returns any row raw, bypassing
the `SECRET_SENTINEL` redaction the dedicated integrations routes apply.
Encrypted rows come back as ciphertext; legacy plaintext rows and the plaintext
`clientId`/`redirectUri` of the Google OAuth config come back as-is.

Status: **fixed 2026-09-23** (S1.1) — `lib/settings-registry.ts` is the
allowlist: 25 keys, each with a read gate, a write gate and a zod schema.
Unregistered keys (every `integration_*`, `integrations:google_*`,
`hr.handbook`, `hr.attendance_config`, `appointment_alert_config`, …) are 404
on both verbs; `PUT` validates `value` and stores the parsed result. Tests:
`tests/unit/settings-registry.test.ts`, `tests/routes/settings.test.ts`.

### A2 — HIGH: two lookup routes have no permission check on create/update
Only `getCurrentUser`:
- `backend/src/routes/compliance-categories.ts:27-31` (POST), `:52-55` (PATCH);
  DELETE checks `compliance:delete` at `:86`.
- `backend/src/routes/inventory-locations.ts:28-31` (POST), `:57-60` (PATCH);
  DELETE checks `inventory:delete` at `:90`.

Any authenticated account on any surface — a team-app `staff` user, a
`lab_technician` — can create, rename, or deactivate these. The global scope
middleware deliberately passes unauthenticated / any-scope traffic through to
route auth (`rbac/middleware/enforceInterfaceScope.ts:108-109`), so nothing
upstream saves it.

Status: **fixed 2026-09-23** (S1.2) — POST gates on `compliance:create` /
`inventory:create`, PATCH on `compliance:update` / `inventory:update`, matching
each route's own DELETE. Tests: `tests/routes/compliance-categories.test.ts`,
`tests/routes/inventory-locations.test.ts`.

### A3 — MEDIUM: UI is admin-only; the backend is a patchwork
The portal renders every section behind `isAdmin`
(`portals/src/features/settings/pages/detail.tsx:118-120` and per-case).
Server-side, "who may change settings" has three answers:

| Endpoint | Gate |
|---|---|
| `/api/lookups/*` writes | hard `roleId === 'admin'` (or `staff:update` for HR types) — `lookups.ts:321-326` |
| `/api/xrays/types` writes | `settings:update` — `xrays.ts:42` |
| `/api/document-tags`, `/api/consent-templates` | `compliance:*` → a receptionist (bundle_compliance_full) can add/delete via API |
| `/api/patient-tags` | `patients:*` → any clinical role can delete a catalog tag (untags every patient) |
| `/api/appointment-type-reminders` PUT | `appointments:update` → receptionist can rewrite SMS reminder rules |
| `/api/settings/kv` | `settings:update` |
| `/locks`, `/low-stock-threshold` POST, `/export`, `/import`, `/api/database/*`, `/api/labs/case-statuses` | admin |

`settings.ts:20-26`, `lookups.ts:288`, `database.ts:37-40` each re-implement
`roleId === 'admin'` despite the engine's "ADMIN BYPASS LIVES HERE AND ONLY
HERE" (`rbac/engine/PermissionEngine.ts:45-46`). Net effect: a custom role with
`settings:*` can PUT any KV key (A1) but cannot manage a single lookup, lock,
or export.

Status: **fixed 2026-09-23** (S1.4 + decision) — the three route-local admin
checks are gone; `settings.ts` and `lookups.ts` call `lib/rbac`'s `isAdmin`,
`database.ts` calls `isAdminUser`. Behaviour is identical (same `roleId`
lookup), it is just defined once. Policy, decided with the owner on
2026-09-23: ordinary KV keys are written with `settings:update` (what
`bundle_settings_full` is seeded for); `pwa_enabled_modules` is admin-only
because it is access control; lookups, locks, export/import and `/database`
stay admin-only. The registry records the per-key answer. Tests:
`tests/routes/settings.test.ts`, `tests/routes/lookups.test.ts`,
`tests/routes/database.test.ts`.

### A4 — LOW: `GET /api/settings/low-stock-threshold` is unauthenticated
`settings.ts:69-73` never calls `getCurrentUser`. Leaks one number; inconsistent
with every sibling route.

Status: **fixed 2026-09-23** (S1.3) — requires a session like every sibling.
Test: `tests/routes/settings.test.ts`.

### A5 — MEDIUM: export ships Google OAuth config and per-user contact tokens
`lib/settings-export.ts:43-51` excludes only the nine `INTEGRATION_KEYS`.
`integrations:google_oauth_config`,
`integrations:google_service_account_config`,
`integrations:google_calendar_auth_method` and every
`integrations:google_contacts_token:<userId>` row go into the downloaded JSON,
while the card says "Integration secrets are excluded for security"
(`data-management-section.tsx:160`). Secrets are encrypted, but bound to
`BETTER_AUTH_SECRET` — importing elsewhere yields undecryptable rows, and
importing in place overwrites live tokens.

Status: **fixed 2026-09-24** (S6) — `isExportableSettingKey` excludes every
`integration_*` key except the branding paths and every `integrations:*` key
by prefix, on export and on import (an imported integration key is reported,
never written). Tests: `tests/unit/settings-export-keys.test.ts`,
`tests/integration/settings-export-roundtrip.test.ts`.

---

## B. Bugs

### B1 — HIGH: Currency & Locale section crashes while typing — PROVEN
`portals/src/features/settings/components/currency-settings-section.tsx:98-103`
constructs `new Intl.NumberFormat(form.locale, { style: 'currency', currency:
form.code })` on every render with the raw field values.

```
node -e "new Intl.NumberFormat('en-GH',{style:'currency',currency:'GH'})"
# RangeError: Invalid currency code : GH
node -e "new Intl.NumberFormat('en_GH',{style:'currency',currency:'GHS'})"
# RangeError: Incorrect locale information provided
```

Clearing the code field, typing the first letter of a new code, or typing a
locale with an underscore throws during render → the section is replaced by
the error boundary. The same unguarded constructor is in
`portals/src/shared/hooks/use-clinic-currency.ts:55` — any bad value that
reaches the KV (via API or import) throws in every `formatMoney` call app-wide.

Status: **fixed 2026-09-23** (S2.1) — both callers go through
`portals/src/shared/lib/currency-format.ts`, which never throws: the preview
shows the problem ("3-letter ISO 4217 code" / "BCP 47 language tag") instead
of a sample, Save is disabled and `handleSave` refuses while the config is
unusable, and `formatMoney` falls back to the clinic default. Note found on
the way: `useClinicCurrency` has no callers anywhere in the portal — dead
code, candidate for S6 cleanup. Tests: `tests/unit/currency-format.test.ts`,
`tests/unit/currency-settings-section.test.tsx`,
`tests/unit/use-clinic-currency.test.tsx`.

### B2 — HIGH: settings import 500s on any cross-environment restore
`clinic_settings.updatedById` is an FK to `user.id`
(`db/schema/operations.ts:24`). The import upserts the file's `updatedById`
verbatim (`settings-export.ts:143-154`) with no per-row try/catch — unlike the
lookup loop directly below it. One row whose author isn't in this DB → FK
violation → whole transaction aborts → "Failed to import settings". That is
the normal case for restoring a backup onto a fresh instance.

Status: **fixed 2026-09-23** (S2.2) — imported clinic rows are stamped with
the importing admin (`updatedById`) and now (`updatedAt`); the file's values
for both are ignored. A row without a key or value is reported, not fatal.
Found and fixed alongside: the lookup loop's per-row `try/catch` never worked
inside the transaction — a failed statement aborts a Postgres transaction, so
every later row failed with 25P02 and the COMMIT was silently a ROLLBACK
while the response still said `imported: N`. Every row now runs in its own
savepoint (`tx.transaction`), so one bad row costs exactly that row. Tests:
`tests/integration/settings-import.test.ts` (real Postgres),
`tests/routes/settings.test.ts`.

### B3 — MEDIUM: payslip PDFs read a branding key nothing writes
`lib/pdf-handlers.ts:15` reads `'clinic_branding'`; the real key is
`BRANDING_KEY = 'integration_branding'` (`lib/branding.ts:19`). No writer of
`clinic_branding` exists anywhere → payslips always render with `{}`.

Status: **fixed 2026-09-23** (S3.2) — the route-local lookup is gone; both
PDF handlers call `lib/branding.getBranding()`, so payslips carry the
configured name, logo, phone and email. Test:
`tests/unit/pdf-handlers-branding.test.ts` (asserts on what reaches the
template — the name alone could not distinguish the two, since the
template's own fallback is also "Denel Dental Clinic").

### B4 — MEDIUM: products/inventory locks live only in process memory
`settings.ts:59-60` writes the lock to the `InMemoryCache` (`lib/cache.ts`).
Every `docker compose up -d` on a `main` push silently unlocks both, and
`canPerformAction` (`settings.ts:90-122`, used by `routes/inventory.ts` and
`routes/products.ts`) lets non-admins write again. The low-stock threshold got
the "persist to DB, lazy-populate cache" fix (`lib/settings-store.ts:1-5`);
the locks never did. Also any unknown `:type` maps to the inventory key
(`:59`).

Status: **fixed 2026-09-23** (S3.1) — `getLock` / `setLock` in
`lib/settings-store.ts` persist `settings:products:locked` /
`settings:inventory:locked` in `clinic_settings` with the same lazy cache as
the threshold; `GET /locks`, `POST /locks/:type` and `canPerformAction` go
through them. The target is validated (`products` | `inventory` → else 400)
and the body must be `{ locked: boolean }`. Proven live: locked products,
restarted the backend, the lock was still held. Tests:
`tests/unit/settings-locks.test.ts`, `tests/routes/settings.test.ts`.

### B5 — MEDIUM: load failure → defaults → Save overwrites real config
Every raw-`useEffect` section (scheduling, inventory-policies, clinical,
security-kiosk, hr-compliance, crm, numbering, currency, monthly-threshold)
does `if (res.success && res.data) setForm(...)` and nothing else — e.g.
`scheduling-policies-section.tsx:45-61`. On a timed-out GET the form silently
shows defaults, Save is enabled, and saving writes defaults over whatever was
stored. The TanStack-based sections don't have this.

Status: **fixed 2026-09-23** (S2.3, owner's choice: shared hook) — the audit
under-counted: `module-visibility` (a toggle after a failed load wrote
`{ [id]: val }` over an empty map, un-hiding every other module),
`operating-hours` (toasted the failure but kept Save live) and
`petty-cash-policy` (on TanStack but never checked `isError`) had the same
outcome, so 12 sections were moved onto one
`useKvSetting(key, defaults)` hook (`shared/hooks/use-kv-setting.ts`) and one
`SettingsLoadError` panel. A failed load now shows the panel with a Retry,
disables Save / the toggles, and `save()` refuses; reads are cached under
`queryKeys.settings.kv(key)` and a save invalidates it, which also closes
the settings-side half of D3. Tests: `tests/unit/use-kv-setting.test.tsx`,
`scheduling-policies-section.test.tsx`, `module-visibility-section.test.tsx`,
`security-kiosk-section.test.tsx` (one of three keys failing blocks the
whole save).

### B6 — MEDIUM: hard-delete with no usage check for four lookups
`USAGE_CHECKS` (`lookups.ts:106-191`) has no entry for `payment-methods`,
`expense-categories`, `units`, `categories` → `noUsage` → delete succeeds
although `payments.method` (`db/schema/billing.ts:106`) and
`items.unit` / `items.category` (`db/schema/inventory.ts:40-42`) store the
slug as free text. Deleting "momo" orphans every momo payment's label and its
`glAccountCode` channel mapping with it.

Status: **fixed 2026-09-23** (S4) — `USAGE_CHECKS` covers all four (by slug;
`categories` also by `items.categoryId`). Test:
`tests/integration/lookups-usage-and-rename.test.ts`.

### B7 — MEDIUM: rename is unguarded where delete is guarded
PATCH (`lookups.ts:390-395`) accepts `name` changes with no usage check and,
unlike POST, no lowercase/trim. Renaming an `appointment-types` slug orphans
every appointment's `type` — the delete checker at `:145-152` proves that
column references by name. `employment-types` / `hr-departments` /
`specialties` are safe (FKs are `ON UPDATE CASCADE`, migrations 0178/0179).

Status: **fixed 2026-09-23** (S4, owner's choice: refuse while in use) — PATCH
normalises `name` like POST and returns 409 `LOOKUP_IN_USE` when the slug
would change on a referenced row; the portal edit dialogs no longer send
`name` at all. Same test file as B6.

### B8 — LOW: "Training" visibility toggle targets a module that no longer exists
`module-visibility-section.tsx:27` lists `training`; there is no such module in
`portals/src/app/modules/registry.ts:41-78` (moved to the HR app).

Status: **fixed 2026-09-23** (S3.3) — the entry is removed and
`TOGGLABLE_MODULES` is exported so
`tests/unit/module-visibility-toggles.test.ts` can check every toggle against
the ids declared in `src/app/modules/*.tsx`; a toggle for a module that is
not registered now fails the suite.

### B9 — LOW: no input validation on writes
- `PUT /kv/:key` with `value` missing → NOT NULL violation → unhandled 500
  (`settings.ts:236-251`).
- `POST /low-stock-threshold` with a non-numeric body →
  `Math.max(0, Math.floor(NaN))` → JSON `null` stored, cache poisoned with
  `NaN`, `success: true` returned (`settings-store.ts:62-71`).
- `POST /appointment-alert-config` → `Number(undefined)` stored
  (`settings.ts:157-162`).

Status: **fixed 2026-09-23** — `/kv` in S1.1 (missing `value` → 400, schema
mismatch → 400 with `issues`); `/low-stock-threshold` and
`/appointment-alert-config` in S2.4 (zod bodies, 400 with `issues`; the
alert config keeps its documented defaults for omitted fields), and
`setLowStockThreshold` itself now throws on a non-finite or negative value
instead of storing NaN / clamping. Tests: `tests/routes/settings.test.ts`,
`tests/unit/settings-store.test.ts`.

### B10 — MEDIUM: HR "auto split" leave save 500s (found while fixing A1)
`hr/src/features/staff/components/leave-defaults-section.tsx` sends
`{ value: null }` for `hr.annual_leave_block_days` when the field is blank.
`clinic_settings.value` is `jsonb NOT NULL` and Drizzle binds a JS `null` as
SQL `NULL` (`sql/sql.js`: `chunk.value === null ? null :
encoder.mapToDriverValue(...)`), so the old handler hit the constraint and
answered `500 Internal server error` — reproduced live against the dev
backend on 2026-09-23. `routes/staff-attendance.ts` already treats a missing
row as "50/50 split", which is what the user meant.

Status: **fixed 2026-09-23** (S1.1) — a `null` on a key whose schema allows it
clears the row; `GET` reports `null` either way. Non-nullable keys reject
`null` with 400. Test: `tests/routes/settings.test.ts`.

### B11 — HIGH: startup self-heal re-created `payments_method_check` on every boot (found while fixing B6)
Migration 0214 dropped the CHECK because payment methods are admin-configurable
(a production incident: `hubtel_pos` / `mobile_money` rejected at INSERT). But
step 10 of `lib/doctor-specialist-schema.ts` — run by `lib/startup.ts` on every
boot unless `SELF_HEAL_SCHEMAS` is off — dropped and re-added the constraint
with a fixed 8-slug list, so 0214's fix was undone on the next start and any
Settings-created payment method failed exactly as before. Verified on the local
DB: the widened constraint existed although 0214 was recorded applied, and its
oid post-dated the `auth_events` table created days later.

Status: **fixed 2026-09-23** (S4, owner's choice: remove the step + new
migration) — step 10 removed, pinned by
`tests/unit/doctor-specialist-schema.test.ts`; migration
`0221_drop_payments_method_check_again.sql` drops it for databases that booted
in between. Details at the bottom.

---

## C. Decorative settings — persisted, never read

Every field name and KV key was grepped across all five apps, excluding the
forms themselves. Zero consumers for:

| Section | Key | What the UI promises |
|---|---|---|
| Scheduling policies | `scheduling:policies` | "Policy changes immediately apply to all new appointment forms and calendar dragging" (`scheduling-policies-section.tsx:187-189`). `allowOverlapForSameDoctor` is in the type with no control. |
| Inventory policies | `inventory:policies` | expiry flags on the dashboard, valuation method, adjustment reason codes |
| Clinical preferences | `clinical:charting_preferences`, `clinical:perio_thresholds` | notation "displayed on odontograms", perio colours, lab SLA "used to calculate expected return dates" |
| Security & kiosk | `security:session_policy`, `security:audit_retention`; of `security:kiosk_config` only `idleLockSeconds` is read (kiosk page) | "enforcing auto-logout and brute-force protection", "automated retention archiving" |
| HR & compliance | `compliance:credential_alert_days`, `hr:working_hours_policy` | expiry notifications; leave quotas — and `annualLeaveDays` here duplicates the *real* `hr.annual_leave_default_days` the HR app and `routes/staff-attendance.ts:301-321` actually use |
| CRM automations | `crm:automation_policies` | 24h/2h reminders, birthday SMS, recall months, quiet hours — only `reminder_payment_cooldown_hours` on the same page is real (`routes/reminders.ts:37-43`) |
| Numbering sequences | `finance:numbering_sequences` | invoice numbers are hardcoded `INV-${year}-` in `lib/ledger-service.ts:57` |
| Petty cash policy (KV half) | `finance:petty_cash` | "Disbursements above the approval threshold will automatically enter the approval queue" (`petty-cash-policy-section.tsx:205-207`); the category-enrolment half is real |
| Operating hours | `operating_hours` | "Drives scheduling and reminders" (`operating-hours-section.tsx:125`) — no reader in any app |

Eight of ~40 sections. Also `SESSION_READABLE_KEYS` (`settings.ts:182-203`)
lists `finance:payment_terms` and `finance:aging_buckets`, which nothing reads
or writes.

Status: **closed 2026-09-23** (owner, section by section — see S5). S5-A
landed the removals, the kiosk trim and the audit-retention wire; S5-B built
the four "wire everything" sections (inventory policies, clinical
preferences, CRM automations, petty-cash policy) — every remaining settings
field now has a reader, and each section's copy says what it does. Addendum: `finance:currency`
belonged in this table too — `useClinicCurrency` had no importers and every
money display uses the hardcoded GHS formatter — and is removed in S5-A.

---

## D. Consistency / drift

- **D1 — key namespaces, and authz hangs off them.** `hr.` (dot → `staff:*`),
  `hr:` (colon → `settings:*`), `integration_*`, `integrations:*`, `settings:*`,
  `finance:*`, `treatment_gate.mode`, and bare keys coexist. The same HR domain
  is governed by different permissions depending on punctuation.
  **Fixed 2026-09-24** (S6, owner's choice: rename the five `hr.` keys) —
  they are `hr:` now (migration 0225 renamed the rows; the registry aliases
  the old spelling so an un-redeployed client keeps hitting the same row;
  backend, portal and HR app writers updated); the registry header documents
  the namespaces. Gates were already per key since S1.1.
- **D2 — export doesn't cover what Settings manages.** `IMPORTABLE_TABLES`
  (`settings-export.ts:10-37`) omits `categories` (Item Categories section),
  `labCaseStatuses` (Lab Workflow), `complianceTags`, `patientTags`, reminder
  templates, appointment-type reminder rules, holidays, tax configurations.
  (Same gap `lookups_audit_report.md` §1 flags.)
  **Fixed 2026-09-24** (S6, owner's choice: lookup-style tables only) —
  `categories`, `labCaseStatuses`, `complianceTags`, `patientTags`,
  `reminderTemplates`, `clinicHolidays` travel with the export; reminder
  stages and tax configurations stay out by design and the export card says so.
- **D3 — two data-access patterns in one feature.** ~13 sections use raw
  `useEffect` + local state, ~14 use TanStack with invalidation. Concrete cost:
  `finance:currency` saved → `useClinicCurrency`'s module-level `memoryCache`
  (`use-clinic-currency.ts:19`) stays stale until reload;
  `monthly_threshold_config` saved → `InventoryLayout`'s own fetch is stale;
  and B5.
  **Fixed 2026-09-24** (S6) — B5 moved every section to `useKvSetting` (S2),
  `useClinicCurrency` went with its section (S5-A), and `InventoryLayout`
  now reads `queryKeys.settings.kv('monthly_threshold_config')` so a save
  refreshes it.
- **D4 — four slug generators** for the same `name` column: `\s+→_` then strip
  (`appointment-types-section.tsx:75-80`, clinical-lookup, expense-categories,
  xray-types); `[^a-z0-9]+→_` (`units-section.tsx:209-212`); `\s+→-`
  (`document-tags-section.tsx:54-59`); plus the backend's own lowercase/trim on
  POST only. The same display name yields different slugs per section.
  **Fixed 2026-09-23** (S4, owner's choice: one helper, two separators) —
  `toLookupSlug()` in `@framada/utils` (`_` for lookups, `-` for document
  tags); all 8 sections use it. Existing rows are untouched.
- **D5 — `/api/lookups/:type/all` hides inactive rows from every non-admin**
  (`lookups.ts:288-295`), yet `hr_admin` is explicitly allowed to manage HR
  lookups and the HR Settings page has reactivate switches
  (`hr/src/features/staff/pages/settings.tsx:256-264`). An hr_admin who
  deactivates a title can never see or reactivate it.
  **Fixed 2026-09-23** (S4) — `/all` returns inactive rows to whoever passes
  the type's write gate (`canWriteLookup`: admin, or `staff:update` for HR
  types). Test: `tests/routes/lookups.test.ts`.
- **D6 — `reports/` still carries a settings tree** calling
  `/api/settings/products/lock` and `/api/settings/inventory/lock`
  (`reports/lib/actions/settings.ts:14`, `:47`) — endpoints that don't exist
  (backend is `/locks/:type`). Dead code in a read-only app.
  **Fixed 2026-09-24** (S6) — the lock helpers are deleted; only the two
  low-stock functions (used by two reports components) remain.
- **D7 — `CLAUDE.md` "Reports visibility" is stale.** No backend route serves
  `finance_visibility`, no portal section writes it,
  `queryKeys.settings.financeVisibility` is unused; only
  `reports/lib/actions/finance-visibility.ts` references it and falls back to
  "everything visible". (Separately: `CLAUDE.md`'s project-docs table lists
  ~20 files that are not on disk — only 8 exist in `project-docs/`.)
  **Fixed 2026-09-24** (S6) — `CLAUDE.md` says Reports visibility is not
  implemented and why; its project-docs table lists only the seven documents
  on disk; the unused `queryKeys.settings.financeVisibility` is gone.
- **D8 — non-admins get blank tabs.** "Clinic Profile" isn't `adminOnly`, but
  its `module-visibility` tab renders `null` for non-admins
  (`detail.tsx:140-141`) while the tab strip lists every section
  unconditionally (`:272-293`). `?section=` isn't validated against the group,
  and an unknown section falls to `default:` → Module Visibility, not the
  group's first tab (`:243-244`).
  **Fixed 2026-09-24** (S6) — `sectionsVisibleTo(group, isAdmin)` (only
  `clinic-profile`, `brand-assets`, `operating-hours` for non-admins) drives
  the tab strip; `?section=` is validated against it and falls back to the
  first visible tab; `default:` is unreachable.
- **D9 — placeholder shipped.** Consent Templates "Upload" writes a fake
  `/mock-templates/…pdf` URL and toasts "coming soon"
  (`consent-templates-section.tsx:135-144`); the Compliance flow then links to
  a 404. The alerts section already has a real R2 upload path (`uploadAudio`)
  to reuse.
  **Fixed 2026-09-24** (S6) — the Upload button opens a file picker and sends
  the PDF through `uploadFile` (`system_docs` / `consent-templates`, `pdf`
  profile); the returned URL fills the field. No placeholder path is ever
  written.
- **D10** — alerts copy says "Max ~1MB" (`alerts-section.tsx:172`); the limit
  is 5 MB (`:23`). **Fixed 2026-09-24** (S6) — copy says 5 MB.

---

## E. Coverage

No tests touch `routes/settings.ts`, `routes/lookups.ts`, or
`lib/settings-export.ts` (export / import / streaming). The only settings-store
test is `tests/integration/admin-v1-comms-cost.test.ts` (SMS/email rates);
`tests/unit/rbac-matrix.test.ts` covers hierarchy expansion only.

Status: partly addressed — S1–S4 added route, unit and integration tests for
`routes/settings.ts`, `routes/lookups.ts`, `lib/settings-export.ts` (import),
the store and the registry (see the Fixed sections). S6 added the export key
rule, the export ↔ import round trip (A5 exclusion, D2 tables, refused
integration keys) and the legacy-alias cases. **Closed 2026-09-24.**

---

## Remediation plan — shippable slices

Each slice is independently mergeable. Statuses: S1–S5 **done** (2026-09-23),
S6 **done** (2026-09-24).

### S1 — Authorization hardening (A1, A2, A3, A4)
1. Introduce a **settings key registry** in backend (`lib/settings-registry.ts`):
   `key → { schema (zod), default, readPerm, writePerm, exportable }`. `GET` /
   `PUT /kv/:key` refuse unregistered keys (404) and validate `value` against
   the schema. Integration and Google keys are registered as
   `readPerm: never, writePerm: never` on this route (their own routes stay the
   only path). `SESSION_READABLE_KEYS` becomes `readPerm: 'session'` entries.
2. Add `checkPermission(compliance:create/update)` to
   `compliance-categories.ts` POST/PATCH and `inventory:create/update` to
   `inventory-locations.ts` POST/PATCH.
3. Add `getCurrentUser` to `GET /low-stock-threshold`.
4. Replace the three local `roleId === 'admin'` helpers with
   `isAdminUser()` from `lib/rbac.ts`; decide once whether settings-family
   writes are "admin" or "settings:update" and apply it to lookups, xray types,
   locks, export/import uniformly.
5. Tests: kv registry (403 on unregistered / unpermitted key, 400 on bad
   value), the two route gates, low-stock auth.

### S2 — Crash and data-loss fixes (B1, B2, B5, B9)
1. Currency: wrap the preview `Intl.NumberFormat` in a try/catch that renders
   "invalid code/locale" instead of throwing; validate `code` (3 letters) and
   `locale` (`Intl.getCanonicalLocales` in try/catch) before Save; same guard
   in `useClinicCurrency.formatMoney` with a fallback to the default config.
2. Import: set `updatedById` to the importing admin (or `null` when the id is
   not in `user`) and wrap each `clinicSettings` row in the same try/catch +
   `failures[]` reporting the lookup loop already has.
3. Raw sections: on load failure, show an error state and disable Save (or
   migrate to `useApiQuery`, which gives this for free — see S6.3).
4. Validation on `/kv` (via S1.1), `/low-stock-threshold`
   (`Number.isFinite` gate, 400 otherwise), `/appointment-alert-config` (zod).

### S3 — Persistence and stale keys (B3, B4, B8)
1. Move the two locks into `clinic_settings` via the `settings-store.ts`
   pattern (`getProductsLocked` / `setProductsLocked`, DB-backed, lazy cache).
2. `pdf-handlers.ts` → use `getBranding()` from `lib/branding.ts`.
3. Drop the `training` entry from `TOGGLABLE_MODULES` (or derive the list from
   the module registry so this cannot drift again).

### S4 — Lookup integrity (B6, B7, D4, D5)
1. Add usage checkers for `payment-methods` (`payments.method`,
   `expenses.paymentMethod`), `expense-categories`, `units`, `categories`
   (`items.unit` / `items.category`).
2. PATCH: reject `name` changes for types whose references are by name and
   have no cascade (`appointment-types`), or cascade them in the same
   transaction; apply the POST normalisation to PATCH.
3. One `toLookupSlug()` in `@framada/utils`; every section and the backend
   POST/PATCH use it.
4. `/all`: show inactive rows to anyone who passes the same write gate the
   route's POST uses (admin, or `staff:update` for HR types).

### S5 — Decorative settings: wire or remove (C)
Per-section decision; candidate consumers where one exists today:

| Setting | Wire into | Or |
|---|---|---|
| `scheduling:policies` | `use-appointment-pickers.ts` / add-appointment sheets (default duration, slot interval); conflict policy in the appointments POST | remove |
| `operating_hours` | appointment pickers + website booking availability | remove |
| `security:kiosk_config` (rest of it) | kiosk page (`enableSelfCheckIn`, `requirePinForExit`) | trim to `idleLockSeconds` |
| `security:session_policy` | Better Auth session `expiresIn` / idle timeout; sign-in rate limiter | remove |
| `security:audit_retention` | a cron purge job over `audit_logs` | remove |
| `finance:numbering_sequences` | `ledger-service.generateInvoiceNumber` + receipt/estimate generators | remove |
| `finance:petty_cash` | petty-cash approval flow | remove the KV half, keep enrolment |
| `hr:working_hours_policy` | delete; point the leave fields at `hr.annual_leave_default_days` (already read by the HR app + backend) | — |
| `compliance:credential_alert_days` | the staff-credentials expiry cron | remove |
| `crm:automation_policies` | reminder/birthday/recare crons + quiet-hours gate on bulk SMS | remove |
| `inventory:policies` | inventory dashboard expiry flags; stock-adjustment reason picker | remove |
| `clinical:*` | odontogram notation, perio chart colours, lab case expected-return calc | remove |

Whichever way each goes, the section copy must stop promising behaviour that
does not exist. Drop `finance:payment_terms` / `finance:aging_buckets` from
`SESSION_READABLE_KEYS` (done in S1.1 — the registry never listed them).

**Decisions (owner, 2026-09-23):**

| Setting | Decision | Slice |
|---|---|---|
| `scheduling:policies` | remove section + key | S5-A ✓ |
| `operating_hours` | keep as clinic-profile info; honest copy | S5-A ✓ |
| `security:kiosk_config` | trim to `idleLockSeconds` | S5-A ✓ |
| `security:session_policy` | remove card + key | S5-A ✓ |
| `security:audit_retention` | wire into the monthly audit-retention cron | S5-A ✓ |
| `hr:working_hours_policy`, `compliance:credential_alert_days` | remove section + keys (leave defaults live in the HR app) | S5-A ✓ |
| `finance:numbering_sequences` | remove section + key | S5-A ✓ |
| `finance:currency` (addendum) | remove section, key and the dead hook | S5-A ✓ |
| `crm:automation_policies` | **wire everything** (24h/2h reminders, birthday send time, recall intervals, quiet hours) | S5-B ✓ |
| `finance:petty_cash` | **wire an approval flow** (limit-driven approval queue, replenish warning, IOU cap) | S5-B ✓ |
| `inventory:policies` | **wire everything** (expiry warning + critical badge, valuation method, adjustment reasons on a stock-adjustment flow) | S5-B ✓ |
| `clinical:charting_preferences`, `clinical:perio_thresholds` | **wire everything** (notation display, prescription default days, lab SLA, perio thresholds) | S5-B ✓ |

Each S5-B build is a feature, not a fix: it starts with its own design
interrogatory (data model, where it surfaces, what it must not break) before
any code, and lands as its own shippable unit.

### S6 — Export/import and consistency (A5, D1, D2, D3, D6–D10, E)
1. Export: exclude by prefix (`integration_`, `integrations:`) via the S1
   registry's `exportable` flag; add the missing tables to `IMPORTABLE_TABLES`.
2. Key naming: one convention (`<domain>:<name>`), migrate `hr.` keys with a
   migration + registry aliases; derive the `staff:*` gate from the registry,
   not from string prefixes.
3. Migrate the raw `useEffect` sections to `useApiQuery` +
   `queryKeys.settings.kv(key)` and make `useClinicCurrency` a TanStack query
   so a save invalidates every reader.
4. `detail.tsx`: validate `?section=` against `group.sections`; hide tabs a
   non-admin cannot render; make `default:` fall to the group's first tab.
5. Consent template upload via `upload-blob`; fix the alerts copy; delete
   `reports/lib/actions/settings.ts` lock calls (or leave to the reports
   simplification plan, but note it there).
6. `CLAUDE.md`: rewrite "Reports visibility" to match reality; prune the
   project-docs table to files that exist.
7. Tests for export/import round-trip (incl. B2's FK case and A5's exclusion).

---

## Suggested order

S1 → S2 → S3 → S4 → S5 → S6. S1 and S2 are the ones with security or data-loss
consequences; S3 is small; S4 protects data integrity; S5 is a product
decision as much as code; S6 is cleanup that gets cheaper once S1's registry
exists.

---

## Fixed — 2026-09-23 (S1.2, S1.3, S1.4)

Done test-first: each new test was run against the unchanged code and failed
for the documented reason (the `403` cases returned `500` because the request
fell through into the DB; the low-stock case returned `200`; the
settings/lookups cases died in the route-local `db.query.user` admin lookup)
before the fix was written.

- `routes/compliance-categories.ts`, `routes/inventory-locations.ts` — POST /
  PATCH now `checkPermission(<module>:create|update)`; DELETE unchanged.
- `routes/settings.ts` — `GET /low-stock-threshold` requires a session; the
  route-local `isAdmin(db, userId)` is deleted and every admin check calls
  `lib/rbac.isAdmin(c, userId)` (same `roleId` lookup). `GET /locks`,
  `POST /locks/:type` and `canPerformAction` no longer open a DB handle they
  only used for that check.
- `routes/lookups.ts` — the four inline `db.query.user.findFirst` +
  `roleId === ROLES.ADMIN` blocks are replaced by `isAdmin(c, user.id)`;
  `ROLES` and the `user` schema import are dropped as unused.
- `routes/database.ts` — `checkAdmin` uses `isAdminUser(user)`; `ROLES`
  import dropped.
- New: `tests/routes/{compliance-categories,inventory-locations,settings,
  lookups,database}.test.ts` (26 tests, DB-free, mocked `lib/rbac`).
- `tests/integration/lookups-employment-departments.test.ts` — its full
  automock of `lib/rbac` stubbed out the `isAdmin` the route now uses, so the
  admin cases 403'd. The mock is now partial (real module, only
  `getCurrentUser` / `checkPermission` stubbed), so the test exercises the real
  admin resolution against the DB — stronger than before. 8/8 pass on the
  local Postgres.

Verification: `vitest run tests/routes tests/unit` → 50 files / 667 tests
green; `tsc --noEmit` clean; Biome 0 errors, no new warnings (every remaining
warning is on a pre-existing `process.env.DATABASE_URL!` or `any` line).

Process note: the first edit pass used Python's `Path.write_text`, which on
Windows rewrote the touched files with CRLF; the repo mandates LF
(`.gitattributes` + `biome.json`). Restored byte-for-byte. Any scripted edit
in this repo must write with `newline='\n'` / `write_bytes`.

## Fixed — 2026-09-23 (S1.1)

Test-first: 13 new `/kv` cases failed against the old handlers for the
documented reasons (any key served → `200` where `404` was expected; wrong
gate on `pwa_enabled_modules`; junk values and a missing `value` accepted;
`null` never cleared) and the registry unit test could not import a module
that did not exist yet.

- New `lib/settings-registry.ts` — 25 entries. 18 session-readable /
  `settings:update` clinic keys; `lab_commission_enabled` (`settings:read` /
  `settings:update`); `pwa_enabled_modules` (`settings:read` / admin); five
  `hr.` keys (`staff:read` / `staff:update`). Each carries a zod schema
  mirroring exactly what its writer sends today (`looseObject`, so extra
  fields are kept, not stripped; the cooldown accepts the numeric string the
  portal sends). The two dead `SESSION_READABLE_KEYS` entries
  (`finance:payment_terms`, `finance:aging_buckets`) are gone.
- `routes/settings.ts` — `GET`/`PUT /kv/:key` resolve the key through the
  registry: 404 unregistered, per-key read/write gate, `PUT` validates and
  upserts atomically (`onConflictDoUpdate` instead of select-then-write); a
  `null` on a nullable key deletes the row (B10). `SESSION_READABLE_KEYS` and
  the `hr.` prefix rule are replaced by the registry; a stale
  "GET /kv/:key" comment that sat above the alert-config block is removed.
- Deviations from the plan text, both deliberate (owner decision 2026-09-23):
  no per-key `default` (GET keeps returning `null`; clients own their
  defaults) and no `exportable` flag yet (added in S6 when export changes).
- Tests: `tests/unit/settings-registry.test.ts` (every key has a sample value
  that must round-trip; own-route keys must be absent; membership is pinned so
  a new key cannot ship untested) and 22 more cases in
  `tests/routes/settings.test.ts`.

Verification: `vitest run tests/routes tests/unit` → 51 files / 770 tests
green; `tsc --noEmit` clean; Biome 0 errors and fewer warnings than before on
`settings.ts` (the rewritten handlers dropped three `!`/`any` sites); LF
confirmed on every touched file. A live probe against the dev backend still
showed the OLD behaviour because the long-running `tsx watch` child (started
2026-09-22 00:00) never restarted on file change — the probe's two writes were
removed from the local DB (`integration_r2`, `module_visibility`, both absent
before). Re-probe after restarting the backend.

**Live probe 2026-09-23, after restart — all S1 behaviour confirmed:** the
port had been held by a `tsx watch` child from 2026-09-22 whose four sibling
watchers from 2026-09-21 were orphaned; with the owner's go-ahead the seven
stale processes were stopped and the current watcher restarted its child.
Against it: unknown / `integration_r2` / `integrations:google_oauth_config` /
`hr.handbook` → 404 on GET and PUT; junk value → 400 with `issues`; missing
`value` → 400; valid → 200 and stored; `null` on `hr.annual_leave_block_days`
→ 200 and the row is gone; `null` on `hr.annual_leave_default_days` → 400;
admin write to `pwa_enabled_modules` → 200; unauthenticated low-stock → 401.
The probe's rows were deleted afterwards; the local DB is back to its three
original rows.

## Fixed — 2026-09-23 (S2.1 / B1)

Test-first: the component test reproduced the crash in jsdom
(`RangeError: Invalid currency code : GH`, `Incorrect locale information
provided`), the hook test threw the same, and the helper did not exist.

- New `portals/src/shared/lib/currency-format.ts` — `currencyConfigProblem`
  (3-letter code, canonicalisable locale) and `createCurrencyFormatter` (null
  instead of a RangeError, including for an out-of-range precision), plus
  `currencyFormatter(config, fallback)` for callers that must always format.
- `currency-settings-section.tsx` — preview shows the problem text when the
  config is unusable; Save disabled and `handleSave` refuses with a toast.
- `use-clinic-currency.ts` — `formatMoney` falls back to
  `DEFAULT_CURRENCY_CONFIG`. (The hook has no callers; left in place, flagged
  for S6.)
- `tests/unit/money-formatting-guard.test.ts` — the two `ALLOWED` entries for
  the section and the hook are replaced by one for the helper, which is now
  the only `style: 'currency'` site among them; the ratchet passes.
- Two test premises corrected during GREEN, both verified in Node first: ES2023
  accepts fraction digits up to 100, so the "impossible precision" case is
  `-1`, not `99`; and `/ISO 4217/` also matched the field's own label, so the
  message assertions use the message text.

Verification: full portal unit suite green (14 files / 156 tests),
`tsc --noEmit` clean, Biome 0 errors / 0 new warnings, LF on every file.

## Fixed — 2026-09-23 (S2.2 / B2)

Test-first against the real local Postgres: the foreign `updatedById` row
failed with FK `23503`; a keyless row aborted the whole import with NOT NULL
`23502`; a unit whose name clashed took the row after it down with it (the
aborted-transaction case). Route tests failed because `importSettings` was
called without the user.

- `lib/settings-export.ts` — `importSettings(db, data, importedById,
  onProgress?)`. Clinic rows are written as `{ key, value, updatedById:
  importer, updatedAt: now }`; `coerceRowForTable` is now used by the lookup
  loop only. Each row's write runs inside `tx.transaction(...)` — a savepoint
  on both drivers the backend uses (`node-postgres` locally,
  `neon-serverless` on Neon; verified in `drizzle-orm@0.45.1`'s session
  code) — through one `attempt()` helper that counts successes and records
  failures.
- `routes/settings.ts` — `/import` and `/import/stream` pass `user.id`.
- Tests: `tests/integration/settings-import.test.ts` (3 cases inside
  `withRollback`), 3 new cases in `tests/routes/settings.test.ts`.

Verification: see the S2 gate below.

## Fixed — 2026-09-23 (S2.3 / B5)

Test-first: the three section tests reproduced the data-loss path in jsdom
(failed GET → defaults rendered → Save/toggle live → PUT of the defaults);
the hook test could not import a module that did not exist.

- New `portals/src/shared/hooks/use-kv-setting.ts` — `useKvSetting<T>(key,
  defaults, { fromStored? })` on `useApiQuery` + `useApiMutation`: returns the
  editable `value`/`setValue`, `loaded`, `loading`, `loadError`, `canSave`,
  `saving`, `isDirty`, `save(next?)`, `refetch`. Seeds the draft from the
  server value (shallow merge over the defaults for plain objects, as-is
  otherwise, or `fromStored`) and only when the server value changes, so
  typing is never clobbered; `save()` throws while `canSave` is false.
- New `settings-load-error.tsx` — destructive `Alert` with the error, a
  plain statement that the values shown are defaults, and a Retry.
- Migrated: scheduling-policies, inventory-policies, clinical-preferences
  (2 keys), security-kiosk (3), hr-compliance-policies (2), crm-automations
  (2), numbering-sequences, currency-settings, monthly-threshold-settings,
  module-visibility, operating-hours, petty-cash-policy. Multi-key sections
  combine their hooks (`canSave` is the AND, `loadError` the first, one Retry
  refetches all). Toast copy is unchanged. `currency-settings` keeps its
  per-field fallback and `operating-hours` its per-day merge as `fromStored`;
  the comma-separated text fields (inventory reasons, credential alert days)
  are seeded from `loaded`, not the draft. `module-visibility` no longer
  invalidates the query by hand — the hook does.
- Still reading these keys outside TanStack (so they do not refresh on a
  save until S6.3): `inventory-layout.tsx` (`monthly_threshold_config`) and
  `use-clinic-currency.ts` (`finance:currency`, itself unused).

Verification: full portal unit suite 18 files / 170 tests green,
`tsc --noEmit` clean, Biome 0 errors and no new warnings (every remaining
`any` is a pre-existing `onValueChange={(v: any) => …}`), LF on every file.

## Fixed — 2026-09-23 (S2.4 / B9) and the S2 gate

Test-first: six route cases (`'abc'`, missing, `-5`, `'soon'`, `0`,
`enabled: 'yes'`) returned `200`; the store setter accepted `NaN` and `-1`.

- `routes/settings.ts` — `LowStockThresholdBody` (`threshold: number ≥ 0`)
  and `AlertConfigBody` (`enabled` boolean, `durationMinutes` int ≥ 1,
  `soundDataUrl` / `soundName` string|null, each defaulting to the existing
  `DEFAULT_ALERT_CONFIG`) are checked with `safeParse`; failures answer
  `400 { error: 'Invalid value', issues }` like `/kv`.
- `lib/settings-store.ts` — `setLowStockThreshold` throws on a non-finite or
  negative number; it still floors.
- Tests: 9 cases in `tests/routes/settings.test.ts`, new
  `tests/unit/settings-store.test.ts`.

**S2 gate:** backend `vitest run tests/routes tests/unit` → 52 files / 785
tests green; DB-backed `settings-import` + `lookups-employment-departments`
11/11 on the local Postgres; backend and portal `tsc --noEmit` clean; portal
suite 18 files / 170 tests; Biome 0 errors, no new warnings anywhere.

## Fixed — 2026-09-23 (S3: B4, B3, B8)

Test-first: the lock routes never called the store and accepted any target
or body (`200` where `400`/store calls were expected); `getLock`/`setLock` did
not exist; the payslip template received fallback branding; the toggle test
found `training` unregistered.

- `lib/settings-store.ts` — `PRODUCTS_LOCK_KEY` / `INVENTORY_LOCK_KEY`,
  `getLock(db, target)` (cache → DB → false) and `setLock(db, target,
  locked, updatedById)` (upsert + cache), same pattern as the threshold.
- `routes/settings.ts` — `GET /locks` reads both through `getLock`;
  `POST /locks/:type` validates the target with a local `z.enum` (a runtime
  list imported from the store would be stubbed away by the route tests'
  module mock) and the body with `z.object({ locked: z.boolean() })`, then
  `setLock`; `canPerformAction` reads through `getLock`. The `cache` import
  and the three route-local constants are gone.
- `lib/pdf-handlers.ts` — route-local `getBranding(db)` deleted; both
  handlers call `lib/branding.getBranding()`.
- `module-visibility-section.tsx` — `training` removed; `TOGGLABLE_MODULES`
  exported for the drift test.
- Tests: `tests/unit/settings-locks.test.ts`, `tests/unit/pdf-handlers-branding.test.ts`,
  4 lock cases in `tests/routes/settings.test.ts`,
  `portals/tests/unit/module-visibility-toggles.test.ts` (scans
  `src/app/modules/*.tsx` for ids rather than importing the registry, which
  would pull in every page).

Verification: backend 54 files / 798 tests, portal 19 files / 172 tests,
both `tsc --noEmit` clean, Biome 0 errors with no warning growth
(`settings.ts` `any` 5→3, `pdf-handlers.ts` `any` 19→18, `!` counts equal
to the committed files). Live: `POST /locks/products {locked:true}` → backend
restarted → `GET /locks` still `products.isLocked: true`; then unlocked and
the row removed, DB back to its three original rows.

Operational note for whoever runs the dev backend: `tsx watch` in this
checkout does not restart on edits to files under `src/routes`/`src/lib`
made by another process; it does restart when `src/node.ts` itself is
touched. Two live probes in this pass ran against stale code because of it
and, through the OLD handlers, wrote rows to the local DB; both times the
rows were identified by content and deleted, and the DB is back to its
original three rows. Bump `src/node.ts`'s mtime (or restart the process)
before trusting a live probe.

## Fixed — 2026-09-23 (S4: B6, B7, D4, D5) and B11

Test-first: `tests/routes/lookups.test.ts` (D5: an `hr_admin` with
`staff:update` got active-only rows on an HR type), the new
`tests/integration/lookups-usage-and-rename.test.ts` (B6/B7: deletes and slug
renames of referenced rows returned 200), `packages/utils/src/slug.test.ts`
(D4) and `portals/tests/unit/{units-section,clinical-lookup-section}.test.tsx`
(edit dialogs sent `name`). All red before the change, green after.

- `routes/lookups.ts` — `USAGE_CHECKS` gains `payment-methods`
  (`payments.method` + `expenses.paymentMethod`), `expense-categories`
  (`expenses.category`), `units` (`items.unit`) and `categories`
  (`items.categoryId` by id OR `items.category` by name). PATCH normalises
  `name` (lowercase/trim, as POST), loads the current row (404 if missing) and,
  only if the slug would change, runs the type's usage check → 409
  `{ error, code: 'LOOKUP_IN_USE', count, refLabel }`, the same shape DELETE
  returns; an unchanged slug is not a rename. `canWriteLookup(c, userId, type)`
  (admin, or `staff:update` for the HR types) is the one write gate and now
  also decides whether `/all` includes inactive rows.
- `@framada/utils` — `toLookupSlug(text, { separator? })`: lowercase,
  `[^a-z0-9]+` → separator, trimmed; `'_'` (default) for lookups, `'-'` for
  document tags. The 8 portal sections (appointment-types, expense-categories,
  payment-methods, units, clinical-lookup, examination-types, xray-types,
  document-tags) use it; their edit dialogs send only the label and show the
  slug as "Internal name (fixed)"; `lib/actions/{expense-categories,
  payment-methods,units}.ts` make `name` optional on update.

B11, found when the B6 integration test hit `payments_method_check` on a DB
where 0214 was already applied:

- `lib/doctor-specialist-schema.ts` — step 10 (drop + re-add of the CHECK)
  removed; `tests/unit/doctor-specialist-schema.test.ts` renders every
  statement the heal executes and asserts none names the constraint.
- `migrations/0221_drop_payments_method_check_again.sql` — `DROP CONSTRAINT IF
  EXISTS`, for databases that booted the old heal after 0214.
- `migrations/meta/_journal.json` — was mid-merge (conflict markers from the
  owner's in-progress merge of origin/main; `migrate.mjs` `JSON.parse`d it and
  aborted, and 3 migration-hygiene tests failed). Resolved per the owner
  (purely local repo, fresh remote coming): origin/main's
  `0215_invoice_line_surcharge` / `0216_fix_invoice_total_consistency_check` /
  `0217_report_day_waivers` keep their numbers (authored first); the local-only
  `0215_user_phone_number_auth` / `0216_drop_user_phone_number_auth` /
  `0217_auth_events` are renamed to 0218–0220 (files, journal idx, and the
  three tags in the local DB's `__applied_migrations`); 0221 is idx 221.
  `project-docs/auth-consolidation-plan.md` now names `0218_…`. **The owner
  still has to `git add` the journal to mark the merge resolved** — no git
  command was run.
- Local DB: `migrate.mjs` then applied 0215–0217 (the surcharge columns, the
  recreated total-consistency check and the waivers table the working-tree
  schema already declared — the drift check is clean now) and 0221.

Verification: backend 55 files / 801 tests (DB-free), integration 9/9 and
migration hygiene 5/5, `packages/utils` 61/61, portal 21 files / 176 tests;
`tsc --noEmit` clean for backend and portal; Biome 0 errors, warnings equal to
the committed files (`lookups.ts` 6→6, the three actions files 6→6,
`clinical-lookup-section.tsx` 1→1), every new file 0 warnings. After the dev
backend restarted on the new self-heal, `pg_constraint` still has no
`payments_method_check`, and the test rows were swept (0 left).

## Fixed — 2026-09-23 (S5-A: decorative settings — removals, kiosk trim, audit-retention wire)

Verified first (grep of every registry key across all apps, excluding the
settings sections themselves): the six removed keys had zero readers;
`security:kiosk_config` was read only for `idleLockSeconds`; the monthly
`audit-retention` cron hardcoded 365 days. Test-first: the registry test
lists the six keys as *not* registered and trims the kiosk sample; new
`tests/unit/audit-retention-job.test.ts` + `getAuditRetentionDays` cases in
`tests/unit/settings-store.test.ts`; the kiosk section test expects exactly
two keys saved. All red before the change.

- Backend `lib/settings-registry.ts` — `finance:currency`,
  `finance:numbering_sequences`, `scheduling:policies`,
  `security:session_policy`, `compliance:credential_alert_days`,
  `hr:working_hours_policy` removed (the generic route now 404s them);
  `security:kiosk_config` schema is `{ idleLockSeconds }`.
- `lib/settings-store.ts` — `getAuditRetentionDays(db)` maps
  `retentionPeriod` (`90_days`/`180_days`/`1_year`) to days, `indefinite` to
  `null`, missing/malformed to 365. `lib/cron/jobs/audit-retention.ts` reads
  it and skips the `audit_logs` purge when null (login attempts stay at 30
  days).
- Migration `0222_delete_dead_settings_keys.sql` — deletes the rows of the six
  keys plus `finance:payment_terms` / `finance:aging_buckets`, and trims a
  stored kiosk row to `idleLockSeconds`. Applied locally (no rows matched; the
  DB keeps its three original rows).
- Portal — deleted `scheduling-policies-section.tsx`,
  `numbering-sequences-section.tsx`, `currency-settings-section.tsx`,
  `hr-compliance-policies-section.tsx`, `shared/hooks/use-clinic-currency.ts`,
  `shared/lib/currency-format.ts` and their four tests; `settings-groups.ts`
  and `pages/detail.tsx` drop the four section ids (Finance, Scheduling and
  Compliance group descriptions rewritten); `security-kiosk-section.tsx` is
  two cards (kiosk idle timeout, audit retention) with honest copy and the
  stray `any` gone; `operating-hours-section.tsx` copy no longer claims to
  drive scheduling; the money-formatting ratchet no longer lists the deleted
  formatter.

Verification: backend 56 files / 800 tests (DB-free) + migration hygiene 5/5,
portal 17 files / 156 tests (four test files deleted with their subjects),
`tsc --noEmit` clean for both, Biome 0 errors and 0 warnings on every touched
file (kiosk section 1→0). Nothing outside the audit doc, the migration and the
registry test still names a removed key, section or hook.

## Built — 2026-09-23 (S5-B inventory: `inventory:policies` wired end to end)

Design decisions (owner): a new Adjust stock flow with quantity read-only in
Edit; stock value figures + cost maintenance under the chosen method; expiry
windows drive the Expiring soon tab only. Verified first: the ledger's
`adjustStock` existed with a reason field but had no route and no caller; the
Edit sheet overwrote `stockQuantity` by a direct column write (no movement
row); nothing issues stock through the ledger yet (COGS never posted); the
Expiring soon tab hardcoded 30 days / 7-day urgency. Test-first (all red
before): `tests/unit/inventory-valuation.test.ts`, `getInventoryPolicies`
cases in `tests/unit/settings-store.test.ts`,
`tests/routes/inventory-adjust.test.ts`,
`tests/integration/inventory-policies.test.ts`,
`portals/tests/unit/{inventory-policies,adjust-stock-sheet}.test.*`.

- `lib/settings-store.ts` — `getInventoryPolicies(db)` /
  `normalizeInventoryPolicies` (field-by-field fallback to the defaults the
  portal section shows: 90 / 30 / fifo / five reasons).
- `lib/inventory-valuation.ts` (new) — `weightedAverageCost`,
  `fifoItemValue` (batches at their receipt cost; stock no batch covers at
  `items.costPrice`), `averageItemValue`, `cogsForIssue`, `valueInventory`,
  `valueItem`. Integer pesewas, rounded.
- `lib/inventory-ledger.ts` — `receiveStock` keeps `items.costPrice` as the
  running weighted average under `weighted_average` (untouched under
  `fifo`); `issueStockFefo` costs COGS by the method (FIFO at the consumed
  batches' cost, average at `costPrice`) through a shared
  `drawDownBatchesFefo`; `adjustStock` now keeps batches in step (a removal
  draws down FEFO, an addition gets a batch at the item's cost, no expiry)
  and returns the movement id.
- `routes/inventory.ts` — `POST /:id/adjust` (`mode` set|delta, `quantity`,
  `reason`, `note`, `locationId`; lock-aware `inventory:update`; 400 on a
  no-op or a removal beyond stock; audit row with from/to + reason);
  `GET /valuation` (registered before `/:id`); `GET /:id` adds `stockValue`
  + `valuationMethod`; `PATCH /:id` rejects `stockQuantity` (`z.never()`).
- Portal — `features/inventory/policies.ts` (defaults, `mergeInventoryPolicies`,
  `expiryStatus`, `validateAdjustment`), `use-inventory-policies.ts`
  (cached under the same KV key the section writes), `components/adjust-stock-sheet.tsx`
  (new count or ± difference, reason picker from the policy + "Other" with a
  note, optional location, live "Result: 10 → 7", refuses a no-op); wired
  into the list row menu and the item detail header; Edit sheet quantity is
  read-only with a pointer to Adjust stock; Inventory page shows a "Stock
  value · FIFO · N items" tile, the Expiring soon tab uses
  `expiryWarningDays` (query + copy), rows/badge turn red inside
  `criticalExpiryDays`; the settings section imports the shared defaults and
  its copy states exactly these effects.

Verification: backend 58 files / 824 tests (DB-free) + ledger and policies
integration 9/9, portal 19 files / 165 tests (run alone — a run in parallel
with the backend suites timed out under load and is not a regression),
`tsc --noEmit` clean for both, Biome 0 errors, warnings equal to the
committed files (`routes/inventory.ts` 8→8 after swapping two new `!` for
`as string`; the pre-existing 8 are the deferred backlog), every new file 0.
Live (temporary local backend, CSRF token from `/api/csrf`): create item
10 @ 250 → `PATCH {stockQuantity}` 400 → `adjust set 7` → `{7, -3}` →
same again 400 "No change" → `delta -8` 400 "only 7 in stock" →
`GET /:id` `stockValue 1750, fifo` → `GET /valuation` `{fifo, 1750, 1}`;
`stock_movements` row `adjustment | -3 | Count Variance — recount` and the
audit row `{stockQuantity: {from: 10, to: 7}, reason}`; probe rows deleted,
0 left.

## Built — 2026-09-23 (S5-B clinical: charting preferences + perio thresholds wired)

Design decisions (owner): notation applies to every display and picker in the
portal (Team/Patient apps keep FDI); `deciduousNotation` stays stored with copy
saying nothing reads it; the four prosthesis SLA fields became one
`defaultLabTurnaroundDays` used as the final fallback; `defaultPrescriptionDays`
prefills new drug rows; perio thresholds colour the chart and set the analytics
tone. Verified first: every table stores FDI; tooth numbers were printed raw in
the odontogram, perio chart, two treatment-plan pickers, four treatment-plan
views, x-ray tab/viewer/share page and the documents tab; `depthColor` and the
perio legend hardcoded 3/5; the analytics tile hardcoded 4 mm; the lab-case
route fell back to a hardcoded 7 days; the prescription stage started rows
with an empty duration. Test-first (all red before):
`packages/utils/src/tooth-notation.test.ts`, `tests/unit/lab-turnaround.test.ts`,
`getDefaultLabTurnaroundDays` cases in `tests/unit/settings-store.test.ts`,
the registry sample, `portals/tests/unit/{clinical-preferences,odontogram-notation}.test.*`.

- `@framada/utils` `tooth-notation.ts` — `formatTooth(fdi, notation)` /
  `formatTeeth`, `fdiToUniversal` (1–32 clockwise from UR8), `fdiToPalmer`
  (`UR6` style), `isPermanentFdi`, `isToothNotation`; anything that is not a
  permanent FDI number is shown as it is.
- Portal `features/clinical/preferences.ts` (types, defaults,
  `mergeChartingPreferences` ignoring the retired SLA keys,
  `mergePerioThresholds` requiring healthy < moderate < severe, `perioLevel`,
  `perioDepthClass`, `perioLegend`) and `use-clinical-preferences.ts`
  (`useClinicalPreferences`, `useToothNotation` with a stable `toothLabel`).
  Wired into: odontogram (`ToothSVG` `label`, chart copy, detail dialog
  title/toast), perio chart (header cells, `depthColor(v, thresholds)`,
  legend from the thresholds), clinical analytics (description + warning tone
  above the healthy max), treatment-plan editor + create sheet (picker option
  labels; values stay FDI), treatment-plans tab / detail / present dialog /
  clinical plan sheet, x-rays tab (thumbnails, viewer title; the entry field
  is labelled "FDI number"), x-ray share page, documents tab
  (`describeItem(item, toothLabel)` + viewer titles), the case prescription
  stage (`PrescriptionForm` seeds `duration` from `defaultPrescriptionDays`),
  the lab-case form (`defaultLabTurnaroundDays` when the offering/express
  option has no turnaround). The public x-ray viewer has no session and keeps
  FDI.
- Backend — registry schema for `clinical:charting_preferences` is
  `{ notationSystem, deciduousNotation, defaultPrescriptionDays,
  defaultLabTurnaroundDays }`; `lib/settings-store.getDefaultLabTurnaroundDays`;
  `lib/lab-turnaround.resolveTurnaroundDays`; `routes/labs.ts` uses both in
  place of `?? 7`; migration `0223_clinical_charting_lab_turnaround.sql`
  strips the four SLA keys from a stored row and adds the default (applied
  locally; no row matched).
- Settings section rewritten on the shared types/defaults: honest copy per
  field, typed selects (the two `any`s gone), a single "Lab turnaround
  fallback" card, and a save guard that refuses unordered perio thresholds.

Verification: utils 6 files / 69 tests; backend 59 files / 829 tests (DB-free)
+ migration hygiene 5/5 + labs GL integration 7/7; portal 21 files / 172
tests (alone); `tsc --noEmit` clean for all three (one mis-placed import in
the analytics page was caught by typecheck and fixed); Biome 0 errors, no
warning growth on any touched file, every new file 0.

## Built — 2026-09-23 (S5-B CRM: `crm:automation_policies` wired)

Design decisions (owner): the 24 h / 2 h switches are backed by global-default
stages in the real reminder engine; birthday sends keep confirm-before-send;
recall months become presets in the recare form; quiet hours hold queued
marketing sends only. Verified first: Scheduling → Appointment Reminders
already stores per-type / global stages in `appointment_type_reminders` that
`lib/scheduler.ts` sends every 15 minutes (the CRM card duplicated it with
nothing behind); `lib/crm-autoqueue.ts` queued birthdays at 06:00 with a
hardcoded message; the recare form started every plan at "1 months"; no send
was ever held; the card's templates used `{{snake_case}}` tags the engines
never rendered. Test-first (all red before):
`packages/utils/src/crm-policies.test.ts`, the onWrite cases in
`tests/routes/settings.test.ts`, `tests/integration/crm-automation-policies.test.ts`.

- `@framada/utils` `crm-policies.ts` — the shared type, defaults (now in
  engine placeholders), `normalizeCrmPolicies` (field-by-field; rewrites
  legacy `{{patient_name}}`-style tags), `isWithinQuietHours` (overnight
  windows), `atClockTime`, `parseClockTime`.
- Backend — `lib/settings-store.getCrmPolicies`; `lib/crm-reminder-stages.ts`
  keeps one keyed template (`crm:appointment_reminder`) and two global-default
  `before_appointment` stages (24 h, 2 h) in step with the switches: created /
  reactivated / kept / deactivated, and never touches a global stage Scheduling
  set up with its own template; the registry gained an optional `onWrite`
  hook that `PUT /kv/:key` runs after the upsert (a failure answers 500 "saved,
  but applying it failed" rather than pretending), and the CRM entry uses it
  (lazy import); `lib/crm-autoqueue.runCrmAutoQueue` reads the policies
  (override param for tests): birthdays are skipped when off, use the
  configured template and are scheduled for the dispatch time, still
  `requiresConfirmation`; `lib/scheduler.runScheduler` holds every queued
  `scheduled_reminders` row inside quiet hours (they fire on the first tick
  after) while appointment-type reminders and credential checks continue.
- Portal — `features/crm/use-crm-policies.ts`; the recare new-plan sheet has a
  preset picker (checkup default, scaling, perio, custom) fed by the policy;
  `crm-automations-section.tsx` rewritten on the shared defaults with copy that
  states each field's real effect, engine placeholder hints, and the missing
  quiet-hours switch.

Verification: utils 7 files / 78 tests; backend 59 files / 832 tests
(DB-free) + CRM policies integration 3/3 + CRM audience 8/8; portal suite
green (see the run below); `tsc --noEmit` clean for all three; Biome 0
errors, no warning growth (`routes/settings.ts` 18→17).

## Built — 2026-09-23 (S5-B petty cash: `finance:petty_cash` wired)

Design decisions (owner): a review gate (at/below the approval limit
auto-confirmed, above needs review), a replenishment log with a running box
balance and low-float warning, and an IOU cap on pending staff disbursements.
Verified first: a petty transaction is an expense in a petty-enrolled
category; every one was created as paid, posted, and dropped into the review
list as `pending` for a non-blocking confirm/flag; nothing recorded a box
float or replenishment; nothing counted IOUs. Money and ledger behaviour are
unchanged by this build. Test-first (all red before):
`packages/utils/src/petty-cash-policy.test.ts`,
`tests/routes/petty-cash-balance.test.ts`,
`tests/integration/petty-cash-policy.test.ts`.

- `@framada/utils` `petty-cash-policy.ts` — the policy type (cedis, as the
  section enters it), defaults, `normalizePettyCashPolicy`, `cedisToPesewas`,
  `decidePettyReview`, `iouCapReached`, `computePettyBalance`.
- Backend — `lib/settings-store.getPettyCashPolicy`;
  `lib/petty-cash-policy.applyPettyCashReviewPolicy` runs in `POST
  /api/expenses` after the petty fields are stamped: a staff-directed
  disbursement is refused with 409 `PETTY_CASH_IOU_CAP` while that staff
  member has `maxActiveIousPerStaff` disbursements pending review; at/below
  `singleApprovalLimit` the row is created already confirmed (stamped
  "Auto-confirmed: at or below the GHS … approval limit"), above it stays
  pending; `lib/petty-cash-balance.getPettyCashBalance` = latest
  replenishment (or the default float from the start of the month) minus
  non-flagged petty spend since; new table `petty_cash_replenishments`
  (migration 0224, applied locally, drift check clean) with `GET /balance`,
  `GET /replenishments`, `POST /replenishments` on `/api/petty-cash`.
- Portal — the Petty Cash transactions tab shows a "Box balance" card (with
  its source and a "Record replenishment" dialog), a low-float warning banner,
  and an "Over limit" badge on disbursements above the approval limit;
  `petty-cash-policy-section.tsx` uses the shared defaults and its copy states
  each field's real effect (the "approval queue before cash can be paid out"
  promise is gone).

Verification: utils 8 files / 82 tests; backend 60 files / 836 tests
(DB-free) + petty policy integration 3/3 + migration hygiene 5/5 + schema
drift clean; portal suite green (run below); `tsc --noEmit` clean for all
three; Biome 0 errors, no warning growth.

### S5 wrap-up

Every settings section now either reads through to behaviour or is gone. The
KV registry lists 12 session-readable clinic keys + 2 settings-gated keys +
5 HR keys; the six
decorative keys were deleted with their rows (0222); `operating_hours` and
`deciduousNotation` remain stored-but-unread by design, and say so in their
copy. Open: S6 (A5 export exclusions, D1–D3, D6–D10, E), plus the doc drift
noted during S5: `CLAUDE.md` lists `project-docs/petty-cash-build-plan.md`,
which does not exist (D7).

## Fixed — 2026-09-24 (S6: A5, D1, D2, D3, D6–D10, E)

Test-first: `tests/unit/settings-export-keys.test.ts` (the key rule and the
table list), `tests/integration/settings-export-roundtrip.test.ts` (export
without secrets, with the new tables; import refuses an integration key and
reports it), the `hr:` renames + legacy-alias cases in
`tests/unit/settings-registry.test.ts` and `tests/routes/settings.test.ts` —
all red before.

- `lib/settings-export.ts` — `isExportableSettingKey` (prefix rule; branding
  kept) replaces the hand-kept `INTEGRATION_KEYS` filter on export and is
  applied on import too; `IMPORTABLE_TABLES` is exported and gains
  `categories`, `labCaseStatuses`, `complianceTags`, `patientTags`,
  `reminderTemplates`, `clinicHolidays`.
- `lib/settings-registry.ts` — the five HR keys are `hr:`; `resolveSettingKey`
  maps the legacy `hr.` spelling and `getSettingEntry` goes through it; the
  generic `GET/PUT /kv/:key` stores under the canonical key. Migration
  `0225_rename_hr_settings_keys.sql` renames rows (dropping a legacy row
  whose canonical twin already exists). `routes/settings.ts` (`/hr-features`),
  `routes/staff-attendance.ts`, the portal and HR app writers use `hr:`.
- Portal — `settings-groups.ts` `NON_ADMIN_SECTIONS` + `sectionsVisibleTo`;
  `pages/detail.tsx` validates `?section=`, offers only visible tabs and never
  reaches `default:`; consent templates upload a real PDF through
  `uploadFile`; alerts copy says 5 MB; `InventoryLayout` reads the
  monthly-threshold flag through the query cache; the export card copy lists
  what travels and what does not; `queryKeys.settings.financeVisibility`
  removed.
- `reports/lib/actions/settings.ts` — the four dead lock helpers deleted.
- `CLAUDE.md` — project-docs table pruned to the seven files on disk (with the
  five undocumented ones added), "Reports visibility" rewritten as not
  implemented, `@framada/utils` bullet updated.

Verification: backend 61 files / 847 tests (DB-free) + export round-trip 2/2,
import 3/3, migration hygiene 5/5; portal suite green (run below); `tsc
--noEmit` clean for backend, portal, HR and reports; Biome 0 errors, no
warning growth (`routes/settings.ts` 18→17, `reports/lib/actions/settings.ts`
5→1). Local DB: 0225 applied (no `hr.` rows existed); the three original rows
are intact.

### Audit wrap-up (2026-09-24)

All findings A1–A5, B1–B11, C, D1–D10 and E are closed across S1–S6. Two
items sit outside this audit and stay with the owner: the in-progress merge
(`backend/migrations/meta/_journal.json` is resolved on disk but still needs
`git add`), and `scripts/neon-legacy-data-migration.sh` — its Neon and VPS
credentials were moved to environment variables on 2026-09-24 (gitignored
`scripts/neon-legacy-data-migration.env`, `.env.example` alongside), so the
script is safe to commit; the old password values should still be rotated
since they sat in a working tree.
