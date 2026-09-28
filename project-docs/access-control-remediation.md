# Access-control remediation (2026-09-24)

**Status: done and verified.** Trigger: a receptionist created in the HR app
could sign in to the portal, but every page bounced back to Overview. The deep
dive behind that symptom found a wider permission leak in the Team app. This
file records what was wrong, what the owner decided, what changed and how it
was verified.

## What was wrong

1. **Onboarding set the wrong role.** The HR wizard's job title ("Receptionist")
   has nothing to do with the system role. The role came from a *Portal access*
   switch on the last step, off by default, so the account got the Team-only
   `staff` role. `POST /api/staff` also wrote `user_scopes (portal, granted
   false)` for everyone; because `user_scopes` overrides the role
   (`PermissionEngine.checkScope`), changing the role later still left the
   portal blocked. Registration approval wrote a denial for every app left
   unticked.
2. **The portal never explained.** Sign-in did not check the portal scope; the
   route guard silently redirected every page to `/dashboard`; the sidebar
   listed modules without a `permission` (Patient Records, Scheduling) to
   everyone; a failed `/api/auth/permissions` load rendered the full,
   unrestricted shell.
3. **The Team bundle opened the HR back office.** `bundle_pwa_standard` gated the
   Team tabs on `payroll:read`, `staff_performance:read`, `staff_requests:read/
   create` and `staff_training:read/update` — the very permissions
   `/api/payroll`, `/api/staff`, `/api/hr` and `/api/hr3` check. Any staff member
   signed in to the Team app could call about forty admin endpoints: every pay
   run and payslip, everyone's attendance and reviews, all requests (with the
   full staff row — bank account, Ghana Card PIN, SSNIT ID, address), and edit
   or grade training. `bundle_pwa_training_only` carried full `staff_training`
   CRUD. The Team app itself never calls those endpoints; its data comes from
   `/api/staff-portal`, which serves only the caller's own records.
4. **Per-user bundles ignored the app.** `resolveUserPermissions` merged every
   `user_bundles` grant whatever its scope, so the pwa bundle HR auto-grants to
   staff-tagged workers counted on the portal too — an HR-onboarded receptionist
   could open Payroll by URL.
5. **HR "No HR access" after sign-in.** The HR scope check is fetched once at
   page load (signed out on the login page) and cached; sign-in reused it.

## Owner's decisions

| Question | Decision |
|---|---|
| Team-app leak | **Both layers**: Team tabs get their own self-service permissions, and the staff-administration APIs refuse Team-app sessions |
| Portal access vs role | **Follow the role**: one required system role in the wizard; no hidden "no portal" flag; the Portal switch stays for per-person exceptions |
| Account without portal access | **Refuse and explain**: login refuses with a reason; existing sessions get a "No portal access" screen; a failed permissions load shows Retry |
| Also | Fix the HR sign-in glitch; repair Melarc's account; verify live with temporary accounts; re-run the RBAC seed locally |

## What changed

**Backend**
- `rbac/engine/BundleResolver.ts` — per-user bundles pass through
  `applicableBundleScopes()` like role bundles (portal → portal + all; pwa → pwa
  + all; hr → hr + portal + all).
- `rbac/middleware/blockTeamAppFromStaffAdmin.ts` (mounted in `app.ts` after
  `detectInterface`) — `/api/staff`, `/api/hr`, `/api/hr3`, `/api/payroll`
  return 403 "Not available in the Team app" when `resolveAppScope` is `pwa`.
  `/api/staff-portal` and every other path are untouched.
- `@framada/rbac` — new modules `MY_PAYSLIPS`, `MY_REQUESTS`, `MY_TRAINING`
  (Team tab gates, never checked by an admin API) and `ROLE_SCOPES`, which
  mirrors `config/roles.config.ts` for the frontends (a unit test fails on
  drift).
- `config/permissions.config.ts` — `my_*:read` definitions; payroll comment and
  description corrected (it *is* wired to `/api/payroll`).
- `config/bundles.config.ts` — `bundle_pwa_standard` = `dashboard:read` +
  `my_requests:read` + `my_training:read` + `my_payslips:read`;
  `bundle_pwa_training_only` = `my_training:read` (authoring lives in HR).
- `routes/staff-core.ts` (`POST /api/staff`) writes only `user_scopes (pwa,
  true)` — the Team-app floor every HR-onboarded person keeps.
  `routes/staff-registration.ts` (approve) writes grants only, never denials.
- Migrations: **0226_team_self_service_permissions** (inserts the `my_*`
  permission rows; rewrites a saved `pwa_enabled_modules` list and Team-app role
  matrices from the old modules to the new ones; removes admin-grade pwa matrix
  grants) and **0227_scope_denials_follow_role** (deletes `portal`/`hr` denials
  that the person's role would not grant anyway — they change nobody's access
  today, they only blocked future role changes; deliberate exceptions are kept).

**Portal**
- `src/app/route-access.ts` — the guard's path → module map (moved verbatim
  from `DashboardLayout`), `isPortalPathAllowed()` and `navItemsAllowed()`,
  shared by the guard, the sidebar and the mobile nav, so a listed link can
  never bounce. Patient Records and Scheduling now declare `permission`.
- Login (`features/auth/pages/login/actions.ts` + `features/auth/portal-access.ts`)
  checks `/api/auth/scope-access?scope=portal` after the password and signs the
  session out with a clear message when the account has no portal access.
- `DashboardLayout` — "No portal access" screen (Sign out), "Couldn't load your
  access" screen (Try again / Sign out), a toast when a typed URL is refused,
  and a refused page is never mounted.

**HR**
- Add-staff wizard: the Access step asks one required **System role** (Staff,
  Receptionist, Lab Technician, Admin) and shows where that role signs in;
  drafts saved before the change load without the old fields.
- Registration approval: the three access switches are replaced by a "Signs in
  to" line that follows the chosen role.
- Edit access: the Portal switch reads "Can sign into the clinic portal"; the
  section explains that access follows the role and a switch is an exception.
- PWA matrix lists (portal and HR copies) offer the `my_*` tabs instead of the
  admin modules.
- Sign-in and the two sign-out handlers reset the cached HR scope check.

**Team app** — the Payslips, Requests and Training tabs gate on `my_payslips`,
`my_requests`, `my_training`.

## Deploying it

`deploy.yml` already runs `migrate.mjs` and then `seed-rbac`: the migrations move
the data, the seed re-syncs the bundle contents. For the few seconds between
them the Team tabs may be hidden; the admin APIs refuse the Team app from the
moment the new backend starts. Locally: `pnpm --filter backend db:local:setup`
does both. Restart the backend after pulling — `tsx watch` has been seen to
miss edits on this machine.

## Verification (2026-09-24)

| Check | Result |
|---|---|
| Typecheck | backend, portal, HR, Team (`tsconfig.app.json`), `@framada/rbac` — clean |
| Backend unit tests | 620 passed, 2 skipped |
| Backend integration + route tests touching this area | 30 files, 338 passed; row counts identical before and after |
| Portal unit tests | 187 passed (15 new) |
| Team unit tests | 35 passed |
| Biome | no new warnings in any touched file; new files clean |
| Regression tests shown to fail on the old code | resolver scope test; Team-bundle guard and the updated Team-app expectations |
| Live, in-process (real app, sessions, CSRF, local DB) | 30/30 checks |
| Live, browser | Team-only account refused at login; receptionist opens all 13 offered links, Payroll URL refused with a notice; "No portal access" and "Couldn't load your access" screens; HR sign-in lands on the dashboard; wizard requires a role and shows where it signs in; Edit access wording |

The temporary accounts (`zz-temp-*@example.com`) and everything they created
were removed. Audit and sign-in log entries for the admin account's test
actions were kept, as a true record of that account's activity.

## Known gaps, not in this change

- `GET /api/access-management/who-can` ignores per-user bundles.
- The `messaging` switch on the PWA matrix gates nothing in the Team app.
- *(Fixed 2026-09-25, see `pre-push-readiness.md`:)* the Team and patient
  `typecheck` scripts used to check zero files; they now run `tsc -b`.
