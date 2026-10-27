# RBAC `doctor`/`external_trainer` role ↔ specialist-record desync (2026-09-29)

## Symptom

A doctor account was created; the doctor did not appear in the appointment
scheduler's doctor dropdown.

## Root cause

The appointment dropdown (`GET /api/doctors`, `backend/src/routes/doctors.ts`)
is sourced **exclusively from the `specialists` table** — never from
`user.roleId`. `roleId='doctor'` is the RBAC permission grant (full clinical
data access, `bundle_clinical_doctor`); a linked `specialists` row is a
*separate* fact (specialty, licence, commission, withholding tax — and the FK
target `appointments.doctorId` actually reads). Nothing enforced that the two
travel together outside one flow.

There are five distinct "become a doctor" code paths in the app. Only one
keeps both sides in sync:

| Path | Sets `roleId='doctor'`? | Creates `specialists` row? | Status |
|---|---|---|---|
| Portal → Doctors → Add Specialist (`add-specialist-sheet.tsx`, `backend/src/lib/doctor-onboarding.ts`, `backend/src/routes/specialists.ts`) | ✅ | ✅ (atomic) | **Correct** — the intended single intake path |
| HR → Add Staff wizard (`team-member-sheet.tsx`) | N/A | N/A | Safe — `doctor`/`external_trainer` are deliberately excluded from `SYSTEM_ROLE_OPTIONS`, by design (see its own header comment) |
| **HR → staff profile → Edit access** (`edit-access-sheet.tsx`) | ✅ (used to) | ❌ never | **Fixed 2026-09-29** — see below |
| **Portal → Access Management → bulk role assign** (`access-management/pages/index.tsx`) | ✅ (used to) | ❌ never | **Fixed 2026-09-29** — see below |
| **HR → Staff → Registrations → review & approve** (`registrations-panel.tsx`) | ✅ | conditionally, only if the separate "Clinical practitioner" toggle is *also* set | **Flagged, not yet fixed** — see below |
| HR → staff profile → Employment → "Clinical practitioner" toggle (`staff-core.ts` `PATCH /api/staff/:id`) | ❌ never | ✅ | Mirror-image gap: creates a bookable specialist with no RBAC clinical permissions unless role is set separately |

The most likely trigger for the reported symptom: an admin created the
account some other way, then used **Edit access** (HR) or **bulk role
assign** (portal) to set their system role to "Doctor". Both write only
`user.role`/`user.roleId` — no `specialists` row — so the account silently
had full clinical-data permissions but was invisible to scheduling/billing.

## Fix (2026-09-29)

Closed at the two generic, decoupled role-assignment surfaces:

- **Backend** (`backend/src/routes/access-management.ts`) — `VALID_STAFF_ROLES`
  (used by both `PATCH /staff/:userId/role` and `POST /staff/bulk-role`) no
  longer accepts `doctor`/`external_trainer`; both endpoints return a 400 with
  a message pointing at Portal → Doctors → Add Specialist. Defense in depth —
  enforced server-side regardless of what any frontend offers.
- **HR** (`hr/src/features/staff/__mock__/team-members.ts`) —
  `TEAM_ROLE_OPTIONS` (the assignable list backing **Edit access** and
  **Registrations → review & approve**, which spreads the same constant) drops
  `doctor`/`external_trainer` and gains `hr_admin` (see below). A new
  `SPECIALIST_ONLY_ROLES` map preserves *display*: `edit-access-sheet.tsx`
  renders a staff member's role as read-only text (not a blank/broken Select)
  when they already legitimately hold one of those two roles, with a note to
  change it from the Doctors page.
- **Portal** (`access-management/pages/index.tsx`) — the bulk-assign picker's
  live role list is filtered to exclude `doctor`/`external_trainer`
  client-side too, so the UI never offers a role the backend will reject.
- **Adjacent bug fixed alongside**: `VALID_STAFF_ROLES` was hand-duplicated in
  `access-management.ts` and `staff-registration.ts`, and **both omitted
  `hr_admin`** — a real, seeded role (`backend/src/config/roles.config.ts`)
  that could not be assigned through either canonical role-assignment
  endpoint. Added to both allowlists (and to `TEAM_ROLE_OPTIONS`).

Regression tests: `backend/tests/routes/access-management.test.ts` — both
endpoints reject `doctor`/`external_trainer` with the guidance message
(`it.each`), pinning the fix.

## Deliberately NOT changed

- `staff-registration.ts`'s own `VALID_STAFF_ROLES` keeps `doctor` and
  `external_trainer` — unlike the generic endpoint above, its approval
  handler creates the linked `specialists` row in the **same request** when
  `isClinicalPractitioner` is set, so role and specialist-linkage are set
  together there, not independently. (Only `hr_admin` was added to it.)

## Known remaining gap (flagged, not fixed — needs a product decision)

`registrations-panel.tsx`'s "review & approve" form still presents **System
role** and the **Clinical practitioner** capability toggle as two independent
controls with no validation linking them. An HR reviewer can pick role =
"none"/anything and separately flip Clinical practitioner on/off in any
combination — picking a role without the toggle (or vice versa) still
produces a desynced account via this one flow. Options to close it: (a) auto-
check Clinical practitioner when a clinical role is picked (there currently
are none in `ROLE_OPTIONS`, since `doctor`/`external_trainer` were removed
from `TEAM_ROLE_OPTIONS` — so this is now lower-risk than before, since a
self-registered "doctor" can no longer be role-assigned to `doctor` from this
screen either), or (b) validate the combination server-side. Not urgent post-
fix, since the two roles that actually need the specialist link are no longer
offered here at all — captured for completeness.

## Related, lower-severity findings (not fixed, informational)

- **Memo/training audience picker** (`hr/src/features/staff/pages/memos.tsx`):
  the "Staff" role-pill sits next to "leave everything unselected to broadcast
  to all active staff" copy. The code is correct (`isBroadcast()` treats an
  empty filter as "everyone"), but clicking "Staff" thinking it means
  "everyone" actually narrows to `roleId==='staff'` only, silently excluding
  doctors/receptionists/lab_technicians/admins/hr_admin. UX risk, not a bug.
- **`GENERAL_STAFF_ROLES`** (`team/src/shared/lib/role-routing.ts`) is a third,
  independently-maintained notion of "who counts as staff" for Team-app route
  guards, and includes `'admin'` despite admin having no Team-app scope.
  Currently harmless — a second guard (`RequireTeamAccess`) independently
  re-checks real scope grants — but is a second source of truth worth
  collapsing into one, eventually.

## Follow-up (2026-10-01): giving an existing specialist a login, locking the type, deactivation

A specialist created as **external**, or as internal without a password, had no
login — and nothing could ever give them one. The edit sheet's *Type* dropdown
let you flip `external → internal`, but `PATCH /api/specialists/:id` only wrote
the column: the specialist then claimed to be internal while having no user, no
credential and no way to sign in. The Access tab was a dead end ("re-create the
record via the wizard"). This is one more path to the same class of desync
described above.

**What changed**

- `POST /api/specialists/:id/grant-login` (`lib/doctor-onboarding.ts`,
  `grantDoctorLogin`) is the one way to give an existing specialist a login. In a
  single transaction, with the specialist row locked `FOR UPDATE`, it marks them
  internal and creates a `doctor` login holding **portal scope only** (never
  `pwa` — a `user_scopes` row overrides the role, and the doctor role
  deliberately lacks the Team app). Needs both `specialists:update` and
  `specialists:create`. The email is lowercased, because Better Auth looks users
  up by `email.toLowerCase()`. Refusals carry stable codes: `NOT_FOUND`,
  `INACTIVE`, `ALREADY_HAS_LOGIN`, `EMAIL_TAKEN`, `STAFF_ALREADY_LINKED`.
  Surfaced as **Grant portal login** on the specialist's Access tab.
- `PATCH` refuses to change `specialistType` (`400 SPECIALIST_TYPE_LOCKED`); the
  edit sheet shows the type read-only and points at the Access tab.
- **Deactivate / Reactivate** are wired up (buttons on the specialist page, "Show
  inactive" on the list). `specialists.isActive` only hides a doctor from the
  scheduler and kiosk — nothing on the sign-in path reads it, so deactivation
  now also suspends the linked login and ends its sessions
  (`lib/specialist-status.ts`, on the primitives in `lib/account-sessions.ts`).
  Reactivation restores only a suspension deactivation made, recognised by its
  `banReason`; an independent ban is left alone. `PATCH { isActive }` goes
  through the same function and requires `specialists:delete` to deactivate, so
  it can't be used to dodge either rule.

**Design decision: no HR staff record.** `grantDoctorLogin` deliberately does
*not* create a `staff` row. The portal's own intake doesn't ("a doctor created
here is NOT an HR employee" — see the header of `specialists/pages/index.tsx`),
the local data agrees (an internal specialist with a login and no staff row is
the normal shape), and a staff row enrols someone in payroll and attendance — an
HR decision with money attached. If the specialist already has an employment
record the new login is linked to it. Note that the HR-contract endpoint
`POST /api/specialists/onboard`, which *does* create a staff row, has no caller
in any frontend today, so the two intake designs in the codebase contradict each
other; this follows the one that is actually in use.

**Observed, not changed**

- **Offboarding leaves the specialist bookable.** `POST` offboarding
  (`access-management.ts`) bans the login, clears the role, revokes scopes,
  soft-deletes the staff row and ends sessions — but never touches
  `specialists.isActive`. An offboarded doctor keeps appearing in the appointment
  scheduler with a dead login (Dr Kuodjo in the local DB is exactly this). The
  reverse of the desync above.
- **The two create paths disagree on portal access.** `POST /api/specialists`
  writes `granted: !!body.portalAccess` (defaults to *denied* if the flag is
  absent; the portal sheet always sends `true`), while `POST /onboard` uses
  `?? true`.
- **Both create paths store the email verbatim.** Better Auth looks users up
  lowercased, so an admin typing `Jemima@Clinic.com` creates an account that can
  never sign in. `grantDoctorLogin` lowercases; the create paths do not.
