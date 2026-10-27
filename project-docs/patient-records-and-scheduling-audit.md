# Patient Records & Scheduling domain audit (2026-09-29)

Full backend + frontend review of the Patient Records and Scheduling domains,
requested after manual UI walkthroughs of both surfaced the doctor-dropdown
bug (see `rbac-doctor-role-desync.md`) and the empty-appointment-types state.
Four parallel deep-dives (patient-records backend/frontend, scheduling
backend/frontend) plus direct verification of every high-severity claim
against the actual code — nothing below is reported without a confirmed
file:line citation the auditor re-read personally. Read-only; nothing in this
document has been fixed yet except where noted.

## How to read this

Findings are grouped by severity, not by domain — scheduling and patient
records are interleaved because several issues share a root cause (RBAC
route/config disagreement; stale-cache-after-mutation; no state-machine
guards). Each finding names its domain in brackets.

---

## CRITICAL — financial integrity, data loss, or a core daily workflow broken

### C1. No double-booking prevention anywhere — client or server [Scheduling] — **SERVER FIXED 2026-09-29, client UX polish deferred**

**Fix:** `checkDoctorAvailable` (`backend/src/lib/doctor-availability.ts`) now
composes three checks in order — declared block-time (existing), a new
`findConflictingAppointment` (another active appointment for the same
doctor), and a new `findChairConflict` (another active appointment in the
same chair, doctor-independent) — returning whichever 409 hits first.
"Active" means not terminal (reuses `TERMINAL_APPOINTMENT_STATUSES` from the
C3 fix); overlap accounts for each existing row's own `durationMinutes` via
real Postgres interval math (`date + (durationMinutes * interval '1
minute')`), not a fixed slot. An optional `excludeAppointmentId` lets a
reschedule check against every *other* appointment without conflicting with
itself.

One function, four call sites, each updated to match what it has available:
- `appointments.ts` create — passes `chairId`; gets the doctor-conflict check
  for free (backward-compatible signature change).
- `appointments.ts` reschedule (`PATCH /:id`) — now also re-checks when
  *only* the chair changes (previously only time/doctor re-triggered the
  guard), passes `excludeAppointmentId: id`.
- `website-bookings.ts` conversion — no call-site change needed at all; it
  gets the new doctor-conflict check automatically.
- `walk-in-service.ts` — switched from calling `findDoctorBlock` directly to
  the full `checkDoctorAvailable`, so a walk-in now gets all three checks
  too, not just block-time.

Regression tests: `backend/tests/integration/doctor-double-booking.test.ts`
(new, 11 cases, against a real throwaway DB — the interval-overlap SQL needs
a real Postgres, not a mock) plus new `makeDoctor`/`makeChair` fixtures and
an extended `makeAppointment` fixture (`chairId`, `durationMinutes`) in
`tests/integration/_fixtures.ts`. RED confirmed (exactly the 3
conflict-should-be-found cases failed with the check disabled; every
no-conflict case correctly stayed green). Verified: typecheck clean, lint
ratchet flat, API contract audit 0 findings, the existing walk-in financial
test (6 cases) and appointment route tests (35 cases) all still pass.

**Deferred, not a gap in the fix's correctness:** the client-side
`portals/src/features/appointments/conflicts.ts` still only checks
appointment-vs-block-time, never appointment-vs-appointment — so staff won't
see a live "this doctor is already booked" warning while picking a time,
only the 409 toast after submitting. The server is now the authoritative,
unbypassable rule (matches the existing block-time pattern: client checks
are a convenience, not the rule), so this is UX polish, not a security or
data-integrity gap. Would need a new client-side conflict function plus
wiring into 4 components (add-appointment-sheet, appointment-detail-dialog's
reschedule, appointment-action-dialogs' RescheduleAppointmentDialog,
add-walk-in-sheet) — a distinct, sizable follow-up if wanted.

Original finding —

`backend/src/lib/doctor-availability.ts:31-59` (`findDoctorBlock`) queries
**only** `doctor_unavailability` (explicit block-time — days off, lunch). It
never checks the `appointments` table for another patient already booked
with the same doctor at an overlapping time. Every booking path — create
(`appointments.ts:280-286`), reschedule (`appointments.ts:426-441`),
website-booking conversion (`website-bookings.ts:305-311`), and walk-in
(`walk-in-service.ts:131-140`) — calls this same block-time-only check and
treats it as "the conflict check." **Chair conflicts aren't checked at all.**
No DB-level exclusion constraint exists either.

Client-side mirrors the exact same gap: `portals/src/features/appointments/conflicts.ts`
only ever compares (new appointment ↔ block-time) or (new block-time ↔
existing appointments) — never (new appointment ↔ existing appointments).

**Consequence:** two staff (or a direct API call, or a race) can book two
different patients with the same doctor at the same time, or into the same
chair, and nothing anywhere objects.

### C2. A cancelled/no-show appointment can still be paid against [Scheduling] — **FIXED 2026-09-29**

**Fix:** `createDraftPayment` (`backend/src/lib/payment-service.ts`) now
rejects when `input.appointmentId` points at a `cancelled` or `no_show`
appointment — checked against a new, deliberately narrower
`NON_PAYABLE_APPOINTMENT_STATUSES` set (in the same shared
`lib/appointment-status.ts` as C3's fix). `completed` is NOT included — that's
the normal "visit finished → bill it" flow and must stay payable. One
chokepoint covers both payment-creation paths: the legacy
`recordLegacyPayment` shim delegates to `createDraftPayment` internally, so
it's covered without a separate change. Regression test:
`backend/tests/integration/payment-appointment-status.test.ts` (new file,
against a real throwaway DB — `createDraftPayment` is deeply wired into a
Drizzle transaction, so this needed the integration-test harness rather than
a unit mock), plus a new `makeDoctor`/`makeAppointment` fixture pair added to
`tests/integration/_fixtures.ts`. RED confirmed against the pre-fix code (2
of 5 cases failed exactly as expected; the 3 "still allowed" cases correctly
stayed green throughout). Verified: typecheck clean, lint ratchet flat, full
backend suite (throwaway DB) unaffected.

Original finding —

`backend/src/lib/payment-service.ts` has zero reference to appointment
status anywhere in its create/post checks (verified directly — grep for
`status.*cancelled|no_show|appointment.*status` returns nothing). Combined
with C3 (no state-machine guard), staff can reopen a cancelled appointment
and take payment on it with no system objection.

### C3. No appointment status state-machine guard [Scheduling] — **FIXED 2026-09-29**

**Fix:** a new shared `TERMINAL_APPOINTMENT_STATUSES` set
(`backend/src/lib/appointment-status.ts` — a small shared lib file so both
route files agree on it, matching this codebase's own convention of routes
importing from `lib/`, not from each other) blocks any further status change
once an appointment is `completed`, `cancelled`, or `no_show`. Applied to
both places that can change `appointments.status`:
- `appointment-workflow.ts`'s `/transition` endpoint — the fetch that used to
  happen twice, conditionally, AFTER the update was applied (once for
  estimate routing, once for the note append) is now one fetch up front that
  also serves the new guard, so this is a net perf improvement too.
- `appointments.ts`'s raw `PATCH /:id` — scoped narrowly to an actual status
  *change* on an already-terminal appointment; a non-status edit (e.g. fixing
  a typo in notes) on a terminal appointment is still allowed and continues
  to go through the existing past-appointment lock (admin + reason required).

Both return `409 { code: 'APPOINTMENT_TERMINAL' }`. No frontend change was
needed — every caller of both endpoints already surfaces `res.error` in a
toast on a non-success response. Regression tests:
`backend/tests/routes/appointment-workflow.test.ts` (new file — this route
had zero test coverage before) and additions to
`backend/tests/routes/appointments.test.ts`, 8 new cases total, RED-confirmed
against the pre-fix code for both files. Verified: typecheck clean, lint
ratchet flat, API contract audit 0 findings.

Original finding —

`backend/src/routes/appointment-workflow.ts:36-109` (`PATCH /:id/transition`)
maps an action (`check-in`/`seat`/`complete`/`no-show`/`cancel`) straight to
a target status with **no check of the appointment's current status** before
applying it. A completed or cancelled appointment can be freely re-checked-in,
re-completed, or reopened in any order. The raw `PATCH /api/appointments/:id`
has the same gap (`status: z.string().optional()`, no CHECK constraint in the
DB either). The team already knows this pattern — `website-bookings.ts:46-58`
has a proper `ALLOWED_TRANSITIONS` map — it just wasn't applied here.

### C4. Check-in-with-payment on the Detail Dialog never transitions the appointment — enables duplicate payment [Scheduling] — **FIXED 2026-09-29**

**Fix:** `handleCheckInSuccess` now awaits `updateAppointment(appointment.id,
{ status: 'checked_in' })` before closing the dialogs, matching the already-
correct sibling in `upcoming-appointments-column.tsx` exactly. Regression
test: `portals/tests/unit/appointment-checkin-payment.test.tsx` (RED
confirmed against the pre-fix code, then GREEN). Verified: typecheck clean,
lint ratchet flat, full portal suite unaffected.

Original finding —

`portals/src/features/appointments/components/appointment-detail-dialog.tsx:470-476`:
```ts
const handleCheckInSuccess = () => {
  setShowCheckInPaymentDialog(false)
  onOpenChange(false)
  onUpdate?.()   // refetch only — no mutation
}
```
`AcceptPaymentSheet` only creates a payment record; nothing in this call
chain PATCHes the appointment's status. Compare the correct sibling,
`upcoming-appointments-column.tsx:381-386`:
```ts
async function handleCheckInSuccess() {
  if (!checkInAppt) return
  await updateAppointment(checkInAppt.id, { status: 'checked_in' })
  setCheckInAppt(null)
  onReload()
}
```
The Detail Dialog's version is simply missing that line (`updateAppointment`
is imported in the file, just never called here). Consequences, verified
against the backend:
- The appointment silently **stays `status: 'scheduled'`** — no
  `checkedInAt`, no calendar re-sync.
- The dialog's own guard (`if (appointment.status !== 'scheduled') { toast;
  return }`, line 461-464) **still passes** next time, so staff can reopen
  the payment sheet and take a **second payment for the same visit** — the
  payment record has no `appointmentId` link at all, so nothing dedupes it.
- A `requiresEstimate` visit never enters the doctor's Activity queue
  (that routing only fires on a `status: 'checked_in'` PATCH), even though
  payment was taken.

The Today-tab sidebar's own check-in path does not have this bug — it's
isolated to the Detail Dialog specifically.

### C5. `patients` has no soft-delete concept at all; deleting one hard-cascades through every case, invoice, and payment they ever had [Patient records] — **FIXED 2026-09-29**

**Fix:** Full archive pattern, mirroring `invoices`/`payment_plans`'
`archived`/`archivedAt`/`archivedBy` convention rather than
`patient_cases`' `deletedAt`-only one (chosen because it already had a
working restore path). Migration `0229_patients_archive.sql` adds the three
columns (`archivedBy` FK's `user.id ON DELETE SET NULL`). `DELETE
/api/patients/:id` is replaced by three routes in `patients.ts`: `POST
/:id/archive` and `POST /:id/unarchive` (both `patients:delete`-gated, same
as before), and `DELETE /:id/permanent` — admin-only, password-gated via
the shared `verifyAdminPassword` (`lib/archive.ts`), and refuses unless the
patient is already archived. `GET /` now excludes `archived = true` by
default in both the unpaginated picker branch and the paginated/search
branch; passing `?archived=true` switches the paginated branch to show only
archived patients (a picker never shows archived patients, full stop —
there's no picker-side opt-in). `GET /:id` and every other per-patient read
(summary, ledger) stay unfiltered, so an archived patient can still be
viewed and restored. The permanent-delete route relies on the same FK
cascades the old hard-delete already relied on (`medicalRecords`,
`treatmentPlans`, `patientCases`, `appointments`, `paymentPlans`,
`payments`, `invoices`, … all `onDelete: 'cascade'` on `patients.id`) — no
manual fan-out delete needed, confirmed by an integration test that inserts
an appointment + medical record + timeline entry, deletes the patient, and
asserts all three are gone.

Frontend: `patient-table.tsx`'s row menu now shows Archive (active view) or
Restore + admin-only Permanently Delete (archived view), reusing the
existing `ArchiveConfirmationDialog` and `AdminPasswordDialog` components
unchanged. The patient list page (`patients/pages/index.tsx`) gained an
Active/Archived tab pair (`?view=archived` in the URL) driving the new
`archived` list param.

Regression tests: `backend/tests/integration/patients-archive.test.ts` (5
cases, real Postgres — the archived-column filtering and the FK-cascade
assumption both need a real DB, not a mock) and
`backend/tests/routes/patients.test.ts` (10 new 401/403/400 cases for the
three new routes, replacing the old `DELETE /:id` cases). Verified:
migration applies cleanly to a fresh throwaway DB, typecheck clean (backend
+ portal), lint ratchet improved (net -2 across both workspaces), API
contract audit clean, full backend suite green, full portal suite green
(one unrelated pre-existing flaky test in
`storage-routing-cloudinary.test.tsx`, confirmed to pass in isolation).

Original finding — `backend/src/db/schema/patients.ts` had no
`deletedAt`/`isActive`/`archived` column (confirmed by reading the full
schema). `DELETE /api/patients/:id` (`patients.ts:1102-1141`) was a genuine
`db.delete(patients)...` — and nearly every clinically/financially
meaningful table cascades on `patients.id` with `onDelete: 'cascade'`:
`medicalRecords`, `treatmentPlans`, `patientCases`, `prescriptions`,
`appointments`, `patientDocuments`, `orthoConsentForms`,
`signedConsentForms` — **and `paymentPlans`, `payments`, `invoices`**.
Deleting a patient silently destroyed every invoice and payment ever issued
to them.

This was the more alarming for what it contradicted one level down:
`patient-cases.ts` deliberately protects a *single case* from exactly this —
soft `deletedAt`, with permanent purge gated on admin role **and password
re-entry** (`patient-cases.ts:658-766`). The patient-level delete bypassed
that entire safeguard with only `patients:delete` permission and a
free-text `?reason=` query param. In practice `patients:delete` was
admin-only (no bundle grants it to a non-admin role), but even an admin got
*weaker* protection deleting a whole patient than deleting one case
underneath them.

### C6. `medical-records.ts` bypasses RBAC entirely — receptionists are configured with full access and are systematically locked out [Patient records] — **FIXED 2026-09-29**

**Fix:** 6 of the 8 handlers (`GET /`, `POST /`, `GET /pending`, `GET /:id`,
`GET /patient/:patientId`, `POST /pending/:id/complete`, `PATCH /:id`) now
gate on `checkPermission(c, user.id, MODULES.MEDICAL_RECORDS, ACTIONS.*)`,
matching every other route file in this codebase. `DELETE /:id` was
deliberately left on the old `isDoctorOrAdmin` check — no bundle grants
`medical_records:delete` to anyone, not even the doctor's own
(`bundle_clinical_doctor` stops at read/create/update), so swapping it would
have silently taken delete capability away from doctors, a behaviour change
nobody asked for. Regression tests:
`backend/tests/routes/medical-records.test.ts` (23 cases) — pin that every
non-delete handler now honors `checkPermission`'s result regardless of the
caller's literal role (proven by temporarily reverting one handler and
confirming the suite catches it), and that `DELETE` still enforces its own
role check even when `checkPermission` is mocked to allow. Verified:
typecheck clean, lint ratchet flat, full backend suite unaffected.

Original finding — every handler in `backend/src/routes/medical-records.ts`
(8 of them) gated on a hardcoded `isDoctorOrAdmin()` (`roleId === 'admin' ||
roleId === 'doctor'`), never `checkPermission`.

Verified directly: `backend/src/config/roles.config.ts:76-108` — the
`receptionist` role includes `bundleIds: [..., 'bundle_clinical_full', ...]`,
and `bundle_clinical_full` (`bundles.config.ts:28-42`) explicitly grants
`medical_records:read`, `medical_records:create`, `medical_records:update`.
The role's own description says *"reception can... Read/write on all
clinical modules."*

**The RBAC config and the route disagree, and the route wins.** Every
receptionist account in this system — exactly as configured — gets a hard
403 from every medical-records route, despite Settings/Access Management
showing them as fully permitted. This is a functional-breakage bug, not a
security hole (over-restrictive, not under), but it means front desk
literally cannot do medical-records work the system says they can.

### C7. Editing a patient doesn't update anything on the page you're looking at [Patient records] — **FIXED 2026-09-29**

**Fix:** added the missing resync effect in `patient-detail-content.tsx`
(`useEffect(() => setPatient(initialPatient), [initialPatient])`) — the two
optimistic local-state updates (PWA toggle) are preserved, since the effect
only fires on a genuine prop change, not on those in-component `setPatient`
calls. Confirmed `EditPatientSheet`'s `invalidates: [queryKeys.patients.all]`
was already correct and sufficient upstream — the bug was purely in this
component never consuming the refetched data — so no other wiring was
needed. Regression test: `portals/tests/unit/patient-detail-refresh.test.tsx`
(RED confirmed against the pre-fix code, then GREEN). Verified: typecheck
clean, lint ratchet flat, full portal suite (270/270) unaffected.

Original finding —

`portals/src/features/patients/components/patient-detail-content.tsx:113`:
```ts
const [patient, setPatient] = useState(initialPatient)
```
Seeded once from the `patient` prop, never resynced (no effect watching
it). `setPatient` is called in exactly 2 places (PWA-toggle, PWA-tab
callback) — **never** from the edit-save path. `EditPatientSheet` is wired
with `onSaved={onReload}` (`patient-detail-content.tsx:608`), and its own
mutation does correctly invalidate `queryKeys.patients.all` — but this
component never reads the refetched data, it keeps rendering its frozen
local `patient` object.

**Confirmed, everyday repro:** Edit Profile → change anything → Save →
toast "Patient updated successfully" — the bio pane, breadcrumb, and every
child tab (Timeline, Medical Records, Documents, Ledger, Statements, PWA
Access — all of which receive `patientId`/`patientName` from this same
stale object) keep showing pre-edit values until a full page reload.

---

## HIGH

### H1. Two endpoints leak clinic-wide data with only auth, no permission check [Scheduling] — **FIXED 2026-09-29**

**Fix:** all three now gate on `appointments:read`/`sms:read`, matching each
one's write-sibling module: `GET /api/doctors` and `GET
/api/doctors/unavailability` both check `appointments:read` (same module as
the already-gated POST/DELETE unavailability routes); `GET
/api/reminders/payment/cooldown-status` checks `sms:read` (matching the
actual-send endpoint's `sms:create`). Verified every frontend caller of all
three endpoints against the roles that reach them — doctor and receptionist
both carry `appointments:read` via their clinical bundles, and the one
bundle granting `sms:create` grants `sms:read` too (and the page that calls
the cooldown endpoint already gates itself on `messaging:read`, only ever
reachable together with that same bundle) — so no legitimate caller lost
access. Regression tests: `backend/tests/routes/doctors.test.ts` (6 cases)
and `backend/tests/routes/reminders.test.ts` (3 cases), RED-confirmed by
temporarily reverting the route files and observing exactly the new 403
cases fail. Verified: typecheck clean, lint ratchet improved, full backend
suite unaffected.

Original finding —
- `GET /api/doctors/unavailability` (`backend/src/routes/doctors.ts:162-164`)
  — omit the optional `doctorId` query param and any signed-in user of any
  role pulls **every doctor's block-time clinic-wide**. The sibling
  POST/DELETE on the same resource *are* gated (`appointments:create`/
  `:delete`) — the GET was missed.
- `GET /api/reminders/payment/cooldown-status` (`backend/src/routes/reminders.ts:21-23`)
  — any authenticated user can pass an arbitrary `?phones=` list and learn
  whether/when a reminder SMS was sent to any phone number. The actual-send
  endpoint is correctly gated on `SMS:create`; this read-only companion isn't.
- (Lower stakes) `GET /api/doctors` is also ungated — any authenticated
  user can list every doctor/specialist.

### H2. `GET /api/ortho-consent` has no permission check, only auth [Patient records] — **FIXED 2026-09-29**

**Fix:** gates on `checkPermission(c, user.id, MODULES.ORTHO_CONSENT,
ACTIONS.READ)`, matching its own siblings. Every current caller (the
ortho-consent feature's own pages) is reached only by roles that already
hold `ortho_consent:read`/`:*` (doctor, receptionist), so no lockout.
Regression test: `backend/tests/routes/ortho-consent.test.ts` (3 cases),
RED-confirmed. Verified: typecheck clean, lint ratchet improved, full
backend suite unaffected.

Original finding — `ortho-consent.ts:16-63` — its own siblings (POST, POST
/process, PATCH delete) all correctly gate on `MODULES.ORTHO_CONSENT`; the
GET didn't. Returned every ortho patient's name/phone/email/photo/signed-
consent status to any authenticated user regardless of role.

### H3. Reminder double-send risk is admitted in the code itself [Scheduling] — **FIXED 2026-09-30**

**Fix:** a new `appointment_type_reminder_sends` table (migration
`0230_appointment_type_reminder_sends.sql`) records one row per
(appointment, policy) pair actually sent — the idempotency record the
`before_appointment` path never had. `processAppointmentTypeReminders`
(now exported for direct testing) filters its candidate list against this
table before building `recipients`, and inserts a row for exactly the
appointments sent to, `ON CONFLICT DO NOTHING`, right after a successful
send. The dedupe is per-appointment, not per-policy, so a second appointment
under the same policy in the same tick still sends correctly. Regression
tests: `backend/tests/integration/appointment-type-reminder-sends.test.ts`
(3 cases — sends once and records it, a re-run against the same window
sends nothing further, a genuinely different appointment under the same
policy still sends), RED-confirmed by isolating the fix from its own
`export` keyword so the RED run proves the *idempotency logic* failed
(`expected "vi.fn()" to be called 1 times, but got 2 times` — the exact
double-send the original code's own comment admitted), not just a missing
export. Verified: typecheck clean, lint ratchet improved, full backend
suite unaffected (149/149 → 150/150 files).

Original finding — `backend/src/lib/scheduler.ts:169-171`:
```
// To avoid duplicate sends within the same 15 minute window, we assume idempotency
// based on the window. However, this could double-fire if the scheduler is rerun
// manually within 15 mins. The system relies on the strict 15 minute offset matching.
```
No sent-tracking table existed for the "before_appointment" (per-type)
reminder path — unlike the rest of the reminder system, which correctly
uses a `lastRunAt` idempotency stamp. Gets worse under horizontal scaling:
the distributed cron lock (`cron/lock.ts:24-34`) silently no-ops without
Redis configured (that part is unchanged by this fix — the dedupe table
protects against a re-run regardless of *why* the scheduler ran twice, cron
lock or manual, so it closes the gap either way).

### H4. The live patient-create/update validation is materially weaker than the schema this codebase actually tests [Patient records] — **FIXED 2026-09-30**

**Fix:** patched the 3 named gaps directly in the live inline schemas
(`backend/src/routes/patients.ts`) rather than swapping in
`lib/validation/patients.ts` wholesale — that file turned out to be
genuinely incompatible with the live wire shape (`dob: z.date()`, not the
ISO string every client actually sends; missing `nationality`,
`howDidYouHear`, `category` and other fields the live route accepts), so
importing it would have silently dropped real fields or rejected every
request outright. Left it and its test alone — out of scope for this fix,
not the "correct schema" the live endpoint should become. The 3 fixes:
`gender` is now `z.enum(['male', 'female', 'other'])` (create: required;
update: optional) — matches the column comment's already-documented 3-value
domain, so this is *not* the narrower 2-value set the frontend's
`PATIENT_GENDERS` list currently offers (that's a separate, deliberately
undecided question — see its own file comment); `email` on the create
schema now has `.email()` (the update schema already had it); `dob` on both
schemas is refined against `!Number.isNaN(new Date(v).getTime())`.
Regression tests: `backend/tests/routes/patients.test.ts` (5 new cases —
reject bad gender/email/dob on create, reject bad gender/dob on update, and
one confirming 'other' is still accepted so the enum didn't narrow the
domain), RED-confirmed (exactly those 5 fail pre-fix; every other case,
including 'other', stays green). Also fixed in passing: the same file's
`validPatientBody` test fixture had a `dateOfBirth` key that never matched
the schema's real `dob` field — harmless before (only exercised by 401/403
checks that never reach validation), but would have made every new
schema-valid test case here silently fail. Verified: typecheck clean, lint
ratchet improved, full backend suite unaffected.

Original finding — `backend/src/routes/patients.ts:831-871` defined its own
inline schema — no `.email()` format check, `gender` accepted any string
(not an enum, despite the column comment listing valid values), `dob` was
an unvalidated string passed straight to `new Date()` with no `NaN` guard.
A separate, correct, stricter schema existed at
`backend/src/lib/validation/patients.ts` — but it was **never imported by
any route**, only by its own dead test file
(`tests/unit/patient-validation.test.ts`, 18 passing tests that proved
nothing about the live endpoint — confirmed via grep, zero `src/` imports).
`POST /api/patients` with `{ gender: "banana", email: "not-an-email" }`
used to succeed and write it straight to the DB.

### H5. Permission-gated UI doesn't match what the backend actually enforces (4 separate instances, same root cause) — **FIXED 2026-09-29**

**Fix:** all four now gate on the specific permission the backend actually
requires, not a coarser derived boolean:
- `AppointmentCard`'s action row (Check-in/Reschedule/Send
  reminder/Mark no-show/Cancel) is now hidden when `isClinicalUser` — the
  same value the Detail Dialog already keys its own `readOnly` off — is
  threaded down through `TodayTab` (previously dropped at that boundary,
  never reaching the card).
- "Block Time" now checks `useCan('appointments','create')`; "Remove Block"
  now checks `useCan('appointments','delete')` — both read the real
  permission via the context-based `useCan` hook rather than any derived
  boolean.
- The patient list's "Edit" now checks `useCan('patients','update')`,
  matching the Patient Detail page's own check.
- `PatientPrescriptionsTab` now accepts a `canEdit` prop (default `false`)
  threaded from `MedicalRecordsSubTabs` — the same prop its sibling
  `PatientCasesTab`/`PatientEstimatesTab` already receive — instead of a
  hardcoded `true`.

**Discovered while fixing "Block Time":** the doctor role's only
appointments-related bundle (`bundle_clinical_doctor`) grants
`appointments:read`/`:update` but **not** `:create`/`:delete` — so a doctor
today gets a 403 from `POST /api/doctors/unavailability` regardless of this
fix. The UI comment above the button ("Doctors may block their own time —
the sheet locks the doctor field to them...") describes a feature that
doesn't currently work end-to-end. This fix makes that already-broken
button correctly disappear for doctors instead of leaving it visibly
clickable-but-403ing, which is a strict improvement, but the underlying
gap — should doctors be able to block their own time at all, and if so,
via a broader grant or a narrower "own time only" carve-out — is a product
decision this fix does not make. Flagged, not resolved.

Regression tests: `backend/tests/routes/reminder-templates.test.ts` — see
H6 below — plus (portal) `unavailability-detail-dialog.test.tsx` (2 cases),
`patient-table-edit-gate.test.tsx` (2 cases), and
`upcoming-appointments-column-gate.test.tsx` (4 cases, covering both the
AppointmentCard and Block Time gates). All RED-confirmed by stashing the
fix and observing exactly the "hides X" assertions fail. Verified:
typecheck clean, lint ratchet improved, full portal suite unaffected
(279/279).

Original finding —
- **[Scheduling]** The Appointment Detail Dialog correctly hides
  Edit/Check-in/Reschedule/Cancel for a clinical-only role
  (`isClinicalUser`), but the Today-tab sidebar's `AppointmentCard` exposed
  the identical actions on the identical appointments with **zero**
  permission gating (`upcoming-appointments-column.tsx` — `TodayTab`
  didn't even accept an `isClinicalUser` prop). A role lacking
  `appointments:update` would see working-looking buttons there that always
  403'd.
- **[Scheduling]** "Block Time" and "Remove Block" were unrestricted in the
  UI (no `isClinicalUser`/permission check at all) but required
  `appointments:create`/`:delete` server-side — same always-403 pattern.
- **[Patient records]** "Edit" on the patient list (`patient-table.tsx`)
  wasn't gated at all (only "Delete" checked `useCan('patients','delete')`),
  while the equivalent button on the Patient Detail page correctly checked
  `patients:update`. A read-only clinical role saw a working-looking Edit
  menu item that 403'd on save.
- **[Patient records]** The Prescriptions tab hardcoded `canEdit={true}`
  regardless of the viewer's actual permission — unlike its sibling Cases
  tab, which correctly threaded `canEdit` through.

Root cause in the scheduling cases: gating was keyed off one derived
boolean (`isClinicalUser = hasPermission('medical_records','read') &&
!hasPermission('appointments','create')`) instead of the specific
permission each action actually requires.

### H6. `isDoctorOrAdmin`-style bypass has a second instance: `reminder-templates.ts` [Scheduling] — **FIXED 2026-09-29**

**Fix:** POST/PATCH/DELETE now gate on `checkPermission(c, user.id,
MODULES.MESSAGING, ACTIONS.CREATE/UPDATE/DELETE)`, matching every other
route file's convention (and this session's C6 fix). The local
`requireAdmin()` helper is gone from the write paths; GET keeps an
admin/non-admin *data-filtering* branch (not an access gate — anyone
authenticated can call GET) via the shared `isAdmin()` helper instead of its
own duplicate DB lookup. Verified directly: the receptionist role already
holds `bundle_messaging_full` (`messaging:*`) via its own bundle list — so
this fix also RESTORES intended receptionist access, exactly the same
pattern as C6, not just a hardening. Regression test:
`backend/tests/routes/reminder-templates.test.ts` (11 cases), RED-confirmed
(a receptionist correctly 403'd pre-fix despite holding
`bundle_messaging_full`). Verified: typecheck clean, lint ratchet improved,
full backend suite unaffected.

Original finding — used `verifySession()` + a hand-rolled `roleId ===
ROLES.ADMIN` check instead of `checkPermission`. A custom role granted
`messaging:update` elsewhere in the app was silently blocked here too — a
consistency/maintainability gap in the same family as C6, and in practice
an active lockout for receptionist (who holds `bundle_messaging_full`
today).

---

## MEDIUM

- **[Scheduling] No timezone safety net.** — **INVESTIGATED 2026-09-30,
  TARGETED FIX applied (see below); full scope deliberately NOT fixed —
  see the accepted deferral below.** Scoping first (per explicit request)
  found the real picture was bigger than this line implied, and one part
  of the original framing was wrong: `@denel/utils`'s `CLINIC_TIME_ZONE`
  pattern (`formatDate`/`formatDateTime`) was NOT "already fixed... and
  applied elsewhere" — it had **zero real call sites anywhere in the
  repo**. Every display call site (backend and all 5 frontend apps)
  independently declared its own same-named local `formatDate` that
  shadowed the import. Three incompatible timezone bases coexist with no
  reconciliation: clinic-pinned (`Africa/Accra`, UTC+0, no DST — unused),
  server-local (backend SMS/past-date-lock/analytics "today" windows),
  and browser-local (portal calendar rendering, team app's schedule page).
  They only agree today because Accra is UTC+0 and hosts default to UTC —
  the real exposure is any staff member whose OS clock isn't UTC+0.

  **Fix (targeted, per explicit decision — the two things this line
  actually named):**
  - `packages/utils/src/date.ts`: exported `CLINIC_TIME_ZONE` (was a
    private const only `formatDate`/`formatDateTime` could see) and added
    `zonedStartOfDay(date?, timeZone = CLINIC_TIME_ZONE)`, which computes
    midnight of a calendar day in an explicit IANA zone as an absolute
    instant, via `Intl.DateTimeFormat` offset arithmetic — correct for any
    fixed-offset zone and any DST zone except a date exactly on its
    transition day, which doesn't apply to Accra.
  - **Past-date-lock**, all 3 places: `validate-date.ts`'s
    `rejectPastAppointmentDate()` (covers `appointments.ts` create/update
    and `website-bookings.ts`'s conversion guard, all 3 already routed
    through it) now compares against `zonedStartOfDay(now)` instead of
    `new Date(); setHours(0,0,0,0)`. The two separately-duplicated
    "existing appointment is read-only once past" inline checks in
    `appointments.ts` (PATCH and DELETE) were consolidated onto a new
    shared `isPastAppointmentDate(date, now?)` in the same file, removing
    the duplication as well as the server-local bug.
  - **SMS formatting**, both places: `scheduler.ts`'s `before_appointment`
    and `on_date`/patient-specific reminder text, and
    `appointment-reminders-service.ts`'s on-booking reminder text, now
    pass `timeZone: CLINIC_TIME_ZONE` (and, for the on-booking path, the
    `en-GH` locale it was previously missing entirely) to
    `toLocaleDateString`/`toLocaleTimeString`.

  Regression tests: `packages/utils/src/date.test.ts` (6 cases —
  `zonedStartOfDay` at Accra, at the UTC-midnight boundary, and in two
  other explicit zones, one positive- and one negative-offset, to prove
  the algorithm generalizes, not just "happens to work for UTC+0`),
  `backend/tests/unit/validate-date-timezone.test.ts` (2 cases),
  `backend/tests/integration/scheduler-sms-timezone.test.ts` (1 case, real
  Postgres), `backend/tests/integration/appointment-reminders-service-timezone.test.ts`
  (1 case, real Postgres) — all 4 files run the guard/SMS-text-building
  code under `process.env.TZ = 'Etc/GMT+12'` (confirmed Node re-reads `TZ`
  per `Date` call, not just at process start) so the divergence between
  clinic time and server time is actually exercised, not just reasoned
  about. RED-confirmed for every case (isolated via re-adding just the
  reverted `timeZone`/algorithm lines, not the whole file, so the failure
  proves the *logic*, not a missing export). Verified: typecheck clean
  (`@denel/utils`, `backend`, `portal`), lint flat on every touched file
  (pre-existing repo-wide `noUnusedImports` errors exist in 8 unrelated,
  untouched files — confirmed pre-existing, not introduced here), full
  backend suite (154 files / 1490 tests) and `@denel/utils` suite (9
  files / 88 tests) green.

  **Explicitly NOT fixed this pass (accepted deferral, per the "targeted
  fix only" decision):** calendar day-bucketing/rendering in
  `portals/.../calendar/{day,week,month}-view.tsx`,
  `calendar-header.tsx`, `day-appointments-sheet.tsx`, and
  `shared/utils/appointment-status.ts`'s `isAppointmentPast` (all
  browser-local, via `date-fns`/naive `Date` with no TZ argument); the
  team app's `SchedulePage.tsx` Yesterday/Today/Tomorrow bucketing (same
  pattern); backend analytics/dashboard "today" windows (~15 occurrences
  of the naive-local-components pattern across `analytics*.ts`,
  `financial-analytics.ts`, `dashboard.ts`); `scheduler.ts`'s `isSameDay()`
  (gates recurring-reminder once-per-day firing) and
  `handleBirthdayReminder`'s naive today-month/day computation — related,
  but not "SMS formatting" or "past-date-lock" as named; and the schema
  itself (`appointments`/`scheduledReminders`/etc. stay plain `timestamp`,
  no `withTimezone: true`, matching the one existing precedent on
  `attendance.ts`). None of these are known-broken in production today —
  same reasoning as above (Accra = UTC+0, hosts default to UTC) — but
  they remain real, undocumented-elsewhere exposure for any non-UTC
  browser client. Revisit as its own pass if that ever becomes load-
  bearing (e.g. genuine multi-timezone operation, or a host/DB that isn't
  UTC).
- **[Patient records] Outstanding balance computed independently in 3
  places** — **INVESTIGATED 2026-09-30, consolidation deferred (see below);
  not a gap in the investigation, a real blocker it found.** `patients.ts`
  summary endpoint, `patients.ts` ledger endpoint, and `patient-statements.ts`
  each re-declare the same `OUTSTANDING_STATUSES` list independently instead
  of reading `patient_balances.arBalance` — the GL-derived materialized
  balance `patient-ar-service.ts` maintains and the reconciliation health
  check treats as authoritative. Verified empirically against a real Postgres
  (`backend/tests/integration/patient-balance-consolidation.test.ts`, kept as
  a permanent drift-detection test) that the two computations agree across
  partial payment, full payment, and voided-invoice scenarios — but **diverge
  when an invoice with a nonzero balance is archived**: `POST
  /invoices/:id/archive` only sets `archived`/`archivedAt`, never touches the
  GL, so `arBalance` keeps counting it forever while the ad-hoc computation
  correctly excludes it (matching the archive-confirmation dialog's own
  promise that archiving "stops appearing in ... outstanding-balance
  calculations"). This isn't a quick patch: `patient_balances` is
  deliberately maintained as a strict mirror of the GL —
  `recomputeFromLedger()` (the reconciliation health check's ground truth)
  recomputes it from `journal_lines` alone with zero awareness of
  `invoices.archived`, so any archive-aware adjustment to `arBalance` would
  be silently reverted by the next scheduled reconciliation run. Making
  archiving GL-aware first (wiring `applyDelta` into archive/unarchive, then
  verifying reconciliation stays consistent) is a real change to the
  accounting subsystem's semantics, not a 3-file read-site swap — deferred
  pending a decision on whether "archived" should mean something different
  at the GL level. The 3 ad-hoc computations are correct and proven to agree
  with each other and (outside the archived-invoice case) with `arBalance`;
  they're left as-is for now.
- **[Patient records] Patient tag writes: a full-replace endpoint and two
  additive endpoints operate on the same rows with different semantics** —
  **FIXED 2026-09-30.** `syncPatientTags` (`backend/src/routes/patients.ts`)
  now excludes every system tag (`patient_tags.isSystem = true`) from its
  `toRemove` computation, not just Pediatric — generalising the precedent
  `patient-auto-tag.ts`'s own top-of-file comment already states as the
  system-wide invariant ("auto-tagging never removes a tag"). Before this,
  only Pediatric was protected: a save built from a stale tag snapshot (e.g.
  the Edit Patient sheet, opened before an unrelated ortho-review-stage save
  auto-applied 'Ortho' moments later) could silently strip Ortho, External,
  or Insurance the moment it wasn't in the caller's `tagIds`. Regression
  test: `backend/tests/integration/patient-tags-sync-race.test.ts` (2 cases
  — the system-tag-survives case, and a sanity check that an ordinary tag
  the caller genuinely unchecked is still removed), RED-confirmed by
  isolating the fix from its own `export` keyword (both fixed and unexported
  states tested separately, so the RED run proves the *protection logic*
  failed, not just a missing export). Verified: typecheck clean, lint
  ratchet improved, full backend suite unaffected.
- **[Scheduling] Calendar events never reflect `durationMinutes`
  visually** — **FIXED 2026-09-30.** `week-view.tsx` and `day-view.tsx` now
  compute each appointment card's height from `event.appointment.durationMinutes`
  (`Math.max(24, (minutes / 60) * pxPerHour)`, floored so very short visits
  stay clickable) instead of a hardcoded 70px/88px. Unavailability
  ("blocked") cards are unchanged — the finding named `durationMinutes`
  specifically, and giving those an accurate height would need a type change
  to thread `startTime`/`endTime` through, which the finding didn't ask for.
  Regression test: `portals/tests/unit/calendar-event-duration-height.test.tsx`
  (2 cases — one per view), RED-confirmed (both fixed heights, 70 and 88,
  fail the "taller" assertion pre-fix). Verified: typecheck clean, lint
  ratchet improved, full portal suite unaffected.
- **[Scheduling] Week-start day is inconsistent on the same page** —
  **FIXED 2026-09-30.** `week-view.tsx` and `month-view.tsx`'s
  `startOfWeek`/`endOfWeek` calls now pass `{ weekStartsOn: 1 }`, matching
  the sidebar's own convention; `month-view.tsx`'s hardcoded
  `['Sun','Mon',...]` header array is reordered to match. Regression test:
  `portals/tests/unit/calendar-week-start-consistency.test.tsx` (2 cases),
  RED-confirmed (both views' day-of-week labels started on 'Sun' pre-fix).
  Verified: typecheck clean, lint ratchet improved, full portal suite
  unaffected.
- **[Patient records] Deleting a patient from the list doesn't remove them
  from the list** — **FIXED 2026-09-29.** `deletePatient()` no longer
  exists (replaced by the C5 archive pattern), and its replacements
  (`archivePatient`/`unarchivePatient`/`permanentlyDeletePatient`) call
  `onReload` on success — but `patients/pages/index.tsx` never wired that
  callback, so the underlying gap this finding describes persisted through
  C5 unnoticed until this pass. Now wired to invalidate
  `queryKeys.patients.all` (covering both the Active and Archived views, not
  just whichever one was open), so an archived/restored/permanently-deleted
  row disappears immediately. Original text, for the record: `deletePatient()`
  bypassed `useApiMutation` (no cache invalidation), and the one call site
  never wired `onReload` either. Stayed in the list, looking active, until a
  manual reload.
- **[Patient records] Restoring an archived invoice/payment plan doesn't
  refresh the Ledger tab or Outstanding Balance** — **FIXED 2026-09-30.**
  `archived-tab.tsx` now takes an `onRefresh` prop and calls it from all 4
  mutations (`unarchiveInvoice`, `unarchivePlan`, `deleteInvoice`,
  `deletePlan`); `patient-ledger-tab.tsx` wires it to its own
  `refreshLedger`. Regression test:
  `portals/tests/unit/archived-tab-refresh.test.tsx` (1 case — restoring an
  invoice calls `onRefresh`), RED-confirmed (prop didn't exist pre-fix).
  Verified: typecheck clean, lint ratchet improved, full portal suite
  unaffected. Original finding, for the record: only the Archived-tab's own
  query key was invalidated, not the sibling ledger query. (The reverse
  direction — archiving — already refreshed correctly.)
- **[Patient records] Two silent-empty states** in the patient add/edit
  forms — **FIXED 2026-09-30.** `tag-picker.tsx` now distinguishes "still
  loading" (renders nothing) from "loaded, zero tags configured" (renders
  the label plus "No tags configured yet — add one in Settings → Patient
  Tags."). The Insurance Provider `<Select>` in both `add-patient-sheet.tsx`
  and `edit-patient-sheet.tsx` is disabled once loading finishes with zero
  providers, with the same "No insurance providers configured yet — add one
  in Settings → Insurance." copy underneath. Regression test:
  `portals/tests/unit/tag-picker-empty-state.test.tsx` (3 cases — loading,
  empty, populated), RED-confirmed (empty case rendered nothing pre-fix).
  The insurance-provider half has no dedicated test (same established
  pattern as the tag picker, low risk, typecheck+lint clean) — a known,
  accepted coverage gap, not an oversight. Verified: typecheck clean, lint
  ratchet improved, full portal suite unaffected.
- **[Patient records] Future date-of-birth is accepted end-to-end, and the
  live Age preview actively masks the mistake** — **FIXED 2026-09-30.**
  `calculateAge` in both `add-patient-sheet.tsx` and `edit-patient-sheet.tsx`
  now returns `null` (blanking the preview) for a negative year difference
  instead of `Math.abs()`-ing it into a plausible-looking positive number;
  both sheets' date-of-birth inputs got `max={localDateISO()}` (the same
  guard pattern already used correctly in the dead `add-patient-dialog.tsx`,
  now applied to the live sheets). Regression test:
  `portals/tests/unit/patient-email-fields.test.tsx` (1 new case — blanks
  the age preview for a future DOB), RED-confirmed (showed a masked wrong
  age, `73`, pre-fix). Verified: typecheck clean, lint ratchet improved,
  full portal suite unaffected.
- **[Scheduling] `add-walk-in-sheet.tsx` has no client-side block-time
  check** at all, unlike every other booking surface — **FIXED 2026-09-30.**
  Reused the existing `findBlockTimeForAppointment`/
  `DEFAULT_APPOINTMENT_MINUTES` helper from `features/appointments/conflicts.ts`
  (the same one other booking surfaces already use) instead of inventing a
  second implementation: fetches the selected doctor's unavailability on
  doctor-select, checks it against "now" client-side, shows an inline
  warning near the Doctor field, disables Submit, and still blocks in
  `onSubmit` as a belt-and-suspenders guard. The backend check is unchanged
  and remains the actual enforcement. Regression test:
  `portals/tests/unit/add-walk-in-block-time.test.tsx` (2 cases), RED-
  confirmed (no warning, submit not blocked, pre-fix). Verified: typecheck
  clean, lint ratchet improved, full portal suite unaffected.
- **[Scheduling] `website-bookings-panel.tsx` doesn't use the codebase's
  own double-submit guard** (`useSubmitGuard`) — **FIXED 2026-09-30.**
  Swapped the plain `useState` boolean for `useSubmitGuard()`, matching the
  same hook's already-established usage in `add-walk-in-sheet.tsx`. No
  dedicated regression test (the hook itself is already covered elsewhere
  and this is a drop-in usage-pattern match, not new logic) — an accepted
  coverage gap, not an oversight. Verified: typecheck clean, lint ratchet
  improved, full portal suite unaffected. Original finding, for the record:
  relied on a plain `useState` boolean, which the shared hook's own doc
  comment explicitly calls insufficient. The backend's `409 if already
  converted` check covers most of the practical risk, but it's a
  read-then-write check, not a transaction/lock.
- **[Patient records] The "Medical Records" tab has a dead permission
  gate** — **FIXED 2026-09-30.** `patient-detail-content.tsx` now actually
  reads `canViewMedicalRecords`: filters it out of `VALID_TABS` and wraps
  both the tab trigger and its content in the check. The caller
  (`patients/pages/detail.tsx`) was also passing the wrong value —
  `isClinicalUser` instead of the real `medical_records:read` permission —
  which would have hidden the tab from receptionists (who hold
  `medical_records:read` but also `appointments:create`, which made
  `isClinicalUser` false for them); fixed to
  `hasPermission('medical_records', 'read')`. Regression test:
  `portals/tests/unit/patient-medical-records-tab-gate.test.tsx` (2 cases —
  hidden when false, shown when true), RED-confirmed (tab rendered
  unconditionally pre-fix). Verified: typecheck clean, lint ratchet
  improved, full portal suite unaffected. Original finding, for the record:
  not exploitable with today's shipped roles (doctor/receptionist both
  carried the needed grants together via the wrong-but-coincidentally-safe
  gate), but the code clearly intended a check that was never wired up.

---

## LOW / informational

- **[Scheduling]** No N+1 found in any list/calendar endpoint — the one
  prior N+1 in `doctors.ts` was already fixed and documented as such.
  Minor per-row-await loops exist in a couple of write paths
  (`documents.ts` instance creation, `patient-cases.ts` prescription
  stage), bounded by request size, not table size. Informational — nothing
  to fix.
- **[Patient records]** `patient-auth.ts` full-table-scans every
  PWA-enabled patient on every patient-portal login/OTP/profile call
  (`findEnabledPatientsByPhone`) instead of an indexed phone lookup —
  **PARTIALLY FIXED 2026-09-30.** Added a partial index
  (`idx_patients_pwa_access_enabled` on `patients.pwaAccessEnabled WHERE
  pwaAccessEnabled = true`, migration `0231_patients_pwa_access_enabled_index.sql`)
  so the function's initial filter is an index scan instead of a full
  table scan of `patients` as the table grows. The phone-matching itself
  (`formatPhoneNumber` normalization against either the patient's own
  phone or a guardian's, done in JS after the DB filter) is deliberately
  UNCHANGED: stored phone values aren't guaranteed to already be in
  normalized form, so an exact-match SQL predicate on
  `phone`/`guardianPhone` risks silently missing a patient whose number
  isn't canonically stored — that's a data-normalization guarantee that
  would need verifying first, not a same-day fix. No dedicated regression
  test (schema-only change, no behavior change — the function's return
  value is identical before/after, only the query plan differs; covered
  by the migration runner's own idempotency). Verified: typecheck clean,
  migration applied cleanly to a real Postgres, index confirmed present
  via `\d patients`.
- **[Patient records]** `documents.ts`/`consent-forms.ts`/
  `consent-templates.ts` gate entirely on `compliance:*`, never scoped by
  `patients:*` — **CONFIRMED INTENTIONAL 2026-09-30 (no code change).**
  Asked directly: `compliance:*` alone is intentional — front-desk/
  compliance staff witnessing signatures at check-in genuinely need this
  without also needing patient-record access. Original concern, for the
  record: anyone with a compliance-module grant can read/sign any
  patient's consent documents regardless of whether they hold any
  patient-record permission.
- **[Patient records]** `MODULES.CONSENT_MANAGEMENT` is defined in
  `@denel/rbac` but never used anywhere — **FIXED 2026-09-30.** Confirmed
  zero references anywhere in the repo (definition + this audit doc were
  the only two matches, for both the constant name and its string value)
  before removing it from `packages/rbac/src/index.ts`. Verified:
  typecheck clean on `backend` and `portal` (the two heaviest `@denel/rbac`
  consumers).
- **[Patient records]** No-show handling only feeds aggregate analytics —
  no per-patient no-show flag/counter/follow-up task exists. **CONFIRMED
  OUT OF SCOPE 2026-09-30 (no code change).** Asked directly: this is new
  feature scope, not a bug fix — left as a documented gap rather than
  built in an audit-remediation pass.
- **[Both]** Several components are dead code with zero importers, found
  incidentally — **FIXED 2026-09-30, with one correction to this finding
  and one additional file found in the process.** Re-verified fresh
  (earlier fixes this session had changed other files) before deleting
  anything:
  - Deleted as originally flagged, confirmed zero importers:
    `add-appointment-dialog.tsx`; the pair
    `check-in-payment-dialog.tsx` + `check-in-payment-card-grid.tsx`
    (each other's only importer); the pair `appointment-list.tsx` +
    `appointments/pages/columns.tsx` (same — each other's only importer).
  - **Correction:** `add-patient-dialog.tsx` was NOT actually dead —
    `portals/tests/unit/patient-email-fields.test.tsx`'s "Add Patient"
    describe block (2 tests) imports and renders it. Left in place;
    flagging this drift is the point of re-verifying before deleting.
  - `case-detail-sheet.tsx`'s `CaseDetailSheet` function was dead, but the
    same file's `CaseStage` type export is alive (4 importers) — removed
    only the function, kept the type (file now holds just the type).
  - **Found in the process, not in the original list:** deleting
    `CaseDetailSheet` orphaned `stage-detail-sheet.tsx`'s
    `StageDetailSheet` function (its only caller) — that file's other two
    exports, `STAGE_LABEL` and `StageDataView`, are still alive elsewhere,
    so only `StageDetailSheet` (and the then-unused `Sheet`/`format`
    imports it alone needed) was removed, same partial-file treatment as
    `case-detail-sheet.tsx`.
  Verified: typecheck clean (`backend`, `portal`), lint flat on every
  touched file.
- **[Patient records]** Minor edge cases: patient-name duplicate check has
  a race (no lock, no unique constraint); `patientId` (FD-YYMM-XXXX)
  generation has no collision retry, unlike the equivalent case-ID
  generator elsewhere in the same file family. — **FIXED 2026-09-30; the
  `patientId` half was CORRECTED 2026-10-01 — the first version did not work.**
  - *Duplicate-name race (fixed as first described).* `patients.ts`'s POST
    handler wraps the duplicate-name check and the insert in one transaction;
    `pg_advisory_xact_lock(hashtext(LOWER(name)))` serializes concurrent creates
    for the same name (the same primitive `staff-core.ts` already uses). Tests:
    `backend/tests/integration/patient-create-name-race.test.ts` — two exercise
    the real route with concurrent requests (end-to-end coverage, but
    timing-dependent), and one forces the interleave deterministically (an
    artificial pause between SELECT and INSERT) so the fix is proven by
    mechanism. RED-confirmed on that case (removing the lock line makes both
    attempts insert).
  - *`patientId` collision retry — the original entry was wrong.* It claimed
    the insert "retries up to 5 times on a `patientId` unique-constraint hit
    (`23505`)" and that this was untested because forcing a collision was
    "disproportionate effort". Forced against a real collision on 2026-10-01 it
    **never retried**, for two independent reasons: (1) drizzle wraps the
    driver's error, so the SQLSTATE is on `err.cause.code` and `err.code` is
    `undefined` — the handler rethrew on the first collision; and (2) even with
    detection fixed, a failed INSERT aborts the surrounding Postgres
    transaction, so every later attempt died with "current transaction is
    aborted" — each attempt needs its own savepoint. A patient-ID collision was
    therefore still a 500. Now fixed: `lib/pg-errors.ts` (`isUniqueViolation`,
    reads the cause chain) and `lib/patient-id.ts` (`insertPatientWithUniqueId`,
    one savepoint per attempt, retries only a collision on
    `patients_patientId_unique`, bounded at 5, with an injectable id source so a
    collision can be manufactured). Tests: `patient-id.test.ts` (8, including
    "leaves the surrounding transaction usable" and "does not retry a failure
    that is not an id collision"), plus a route-level case in
    `patient-create-name-race.test.ts` that pre-seeds `FD-YYMM-AAAA` and forces
    the route's first draw to be `AAAA`. Mutation-checked: restoring either flaw
    (reading `err.code`, or dropping the savepoint) fails the suite, the second
    with exactly "current transaction is aborted".
  - **Same bug elsewhere, not touched here.** The pattern this was copied from
    — `lib/patient-case-service.ts`'s `ensureCaseForPlan` (`err.code !==
    '23505'`) — has the same flaw, and so do roughly a dozen route handlers that
    map a unique violation to a friendly 409 by reading `err.code` directly
    (`labs.ts`, `lookups.ts`, `treatments.ts`, `request-types.ts`,
    `document-tags.ts`, `inventory-locations.ts`, …). Verified against the
    node-postgres driver (local dev and the Hetzner VPS), for both top-level
    and in-transaction queries: `err.code` is `undefined` and the SQLSTATE is
    on `err.cause.code`, so those handlers never match and the user gets a 500
    instead of the intended message. (The Neon serverless driver used on
    staging goes through the same drizzle wrapper but was not checked
    directly.) `staff-core.ts` and `staff-registration.ts` already read
    `cause.code` correctly. `isUniqueViolation` is the fix; adopting it there is
    a separate, mechanical pass.
  Verified: typecheck clean, lint flat, no schema change.

---

## Test coverage — why this shipped unnoticed

Across the ~23 backend route files in these two domains, **only 6 have any
test at all**, and of those, **none exercise the specific business logic
this audit flagged** — conflict detection, status-transition validity,
reminder idempotency, or the RBAC-config-vs-route-check agreement. Existing
tests cover auth gates (401/403), input-shape validation, and in one case
(`patient-validation.test.ts`) a schema that isn't even wired to the live
route (see H4). `tests/integration/concurrency.test.ts` covers race
conditions only for financial GL posting — there's no concurrency test for
two simultaneous appointment bookings against the same doctor/slot, which
is exactly the untested gap in C1.

## Full backend suite result

Ran against a fresh throwaway Postgres 17 (port 5499, migrated from empty —
228 migrations, RBAC-seeded, admin-seeded) — not the user's dev DB;
container removed after the run. **139/139 test files, 1386/1386 tests
pass.** (An interim run without the admin-user seed showed 111-129
failures, all `"integration fixtures need at least one row in \"user\""` —
a gap in the throwaway-DB setup, not an app bug; resolved by seeding admin
before the final run.) This confirms none of the findings above are
currently caught by the existing suite — the backend is "green" only in the
sense that nothing it tests today fails; it does not test the specific
gaps this audit found (see Test coverage section above).

## Suggested order, if fixing

Not prioritized by ease — by what would actually hurt in daily use first:
C7 (edit-patient not refreshing) and C6 (receptionist medical-records
lockout) are the two most likely to already be visibly, dailly broken for
anyone using the app normally. C4/C2/C3 (payment/status integrity) and C1
(double-booking) are the two most consequential if unnoticed. C5 (patient
hard-delete) is the highest blast-radius but only triggers on a rare,
deliberate action — still worth closing before this goes anywhere near
production data.
