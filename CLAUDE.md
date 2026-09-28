# CLAUDE.md — Framada Monorepo

> **⚠ Rebrand in progress.** This repo is being incrementally rebranded from
> "Framada Dental" (the original template) to **Denel Dental** (the actual
> clinic). Package names (`@denel/*`) and app **domains** (`deneldental.com`) are
> done (2026-09-27/28); some of this doc, the `website/` app, seed/test data and
> infra names still say "Framada" because the rename hasn't reached them — not a mistake.
> Read `project-docs/denel-rebrand-plan.md` before assuming a "Framada"
> reference is wrong, before renaming anything, or before starting work
> outside its documented current scope.

## Project overview

Framada Dental Clinic management system. Multi-app pnpm monorepo orchestrated by Turborepo.

| App | Directory | Type | Production URL | Hosting |
|-----|-----------|------|----------------|---------|
| `portal` | `portals/` | Vite SPA | `portal.deneldental.com` | Cloudflare Pages |
| `team` | `team/` | Vite PWA | `team.deneldental.com` | Cloudflare Pages |
| `patient` | `patient/` | Vite PWA | `app.deneldental.com` | Cloudflare Pages |
| `hr` | `hr/` | Vite SPA | `hr.deneldental.com` | Cloudflare Pages |
| `reports` | `reports/` | Vite SPA | `reports.deneldental.com` | Cloudflare Pages |
| `website` | `website/` | Next.js (via `@cloudflare/next-on-pages`) | `deneldental.com` | Cloudflare Pages |
| `backend` | `backend/` | Node.js Hono | `api.deneldental.com` | Hetzner VPS (Docker Compose at `/opt/framada`) |
| `website-backend` | `website-backend/` | Node.js Hono | — | Skipped for now |

### Staging

| App | Staging URL | Hosting |
|-----|-------------|---------|
| `portal` | `staging.portal.pages.dev` | Cloudflare Pages (preview deploy) |
| `team` | `staging.team.pages.dev` | Cloudflare Pages (preview deploy) |
| `patient` | `staging.patient.pages.dev` | Cloudflare Pages (preview deploy) |
| `hr` | `staging.hr.pages.dev` | Cloudflare Pages (preview deploy) |
| `reports` | `staging.reports.pages.dev` | Cloudflare Pages (preview deploy) |
| `website` | `staging.website.pages.dev` | Cloudflare Pages (preview deploy) |
| `backend` | Render-assigned URL (`*.onrender.com`) | Render |

> Frontend deploys run in GitHub Actions: CI builds each app with Doppler-injected
> env vars, then uploads the prebuilt bundle to its CF Pages project via wrangler.
> CF Pages projects exist as "direct upload" targets — no Git connection, no env
> vars in CF dashboard.

### Databases

| Database | Provider | Purpose |
|----------|----------|---------|
| Postgres (self-hosted, `/opt/framada`) | Hetzner VPS | Production |
| Neon `framada-dev` | Neon | Staging + local dev |
| Neon `framada-backup-live` | Neon | Daily production backup target |

## Key rules

- **backend is the ONLY backend** — all apps hit `api.deneldental.com`.
- **Production database** — backend connects to PostgreSQL on the Hetzner VPS. Never run destructive DB commands (DROP, TRUNCATE) without explicit confirmation.
- **reports/ is read-only** — no write operations. Visibility controlled via the `finance_visibility` settings in backend.
- **No direct DB access from frontends** — all data flows through backend's API.

## Secrets management

- **Doppler** — source of truth for all app secrets. Project: `framada-projects`, configs: `dev`, `stg`, `prd`.
- **GitHub Secrets** — platform tokens only (Cloudflare, Render deploy hook, `HETZNER_HOST`/`HETZNER_USERNAME`/`HETZNER_SSH_KEY`, Doppler service tokens).
- **Render env** — backend staging runtime env vars. Synced from Doppler `stg` via Doppler-Render native integration (configured in Doppler dashboard, not CI). Service config lives in `render.yaml` at the repo root.
- **Hetzner VPS env** — backend production runtime env vars live in `/opt/framada/.env` on the VPS. Every production deploy merges Doppler `prd` into it (`.github/workflows/deploy.yml`, since 2026-09-04): keys Doppler defines win, keys only on the VPS (e.g. `DATABASE_URL`) are kept and can only be read or changed on the server, and the deploy aborts before touching the container if `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOWED_ORIGINS` or `PRIVATE_FILE_REF_SECRET` is empty after the merge.
- **Full inventory** of every secret, third-party credential (Hubtel, Resend, R2, Sentry, Google, …) and setup switch, with where each one goes: `project-docs/secrets-and-integrations.md`.
- **Local dev** — run with `doppler run -- pnpm dev` to inject secrets from the `dev` config.
- Frontend env strategy:
  - Vars with the **same value across all apps** (backend URL, auth URL, etc.) → stored once in Doppler as `VITE_*` and read directly by Vite
  - Vars with **different values per app** (each app's own URL, each app's own Sentry project) → stored per-app in Doppler (`PORTAL_VITE_*`, `PWA_VITE_*` — note: team's vars are still `PWA_`-prefixed — `PATIENT_VITE_*`, `HR_VITE_*`, `REPORTS_VITE_*`) and remapped onto the shared `VITE_*` name in each app's `vite.config.ts` `define` block
- CI uses `doppler run --` for build-time secrets (CF Pages app builds, DB migrations).

### Per-app env vars must be declared in `turbo.json`

**Turbo 2 runs tasks in strict env mode by default.** A task only sees the vars
declared in `turbo.json` plus the `VITE_*` set that framework inference adds for
Vite packages. Per-app names are **not** `VITE_*`-prefixed, so they are filtered
out unless listed in the `build` task's `env` array — and each `vite.config.ts`
then bakes `undefined → ''` into the bundle, silently disabling Sentry (or hard-
failing boot, since `config/env.ts` requires a DSN when `VITE_APP_ENV=production`).

**When adding a new `<APP>_VITE_*` var, you must touch two files:** the app's
`vite.config.ts` `define` block *and* `turbo.json`'s `build.env` list. Missing the
second is silent — the build succeeds and ships an empty value.

Do not derive the prefix from the app name in CI. That was tried and broke `team`
(matrix name `team` → `TEAM_VITE_SENTRY_DSN`, but the Doppler var is
`PWA_VITE_SENTRY_DSN`). The remap belongs in `vite.config.ts`, which is the single
source of truth; `deploy.yml` just runs `doppler run -- <build_cmd>`.

#### Debugging "my env var isn't reaching the bundle"

Running `node -e 'console.log(process.env.FOO)'` in your shell proves nothing —
you already know what you exported. The var has to be probed **inside** the Turbo
task boundary, which is where the filtering happens.

Cheapest check, no code and no build — print the env keys Turbo resolves per task:

```bash
pnpm turbo run build --filter=portal --dry=json   # inspect the task's resolved env list
```

If you need to see live values at task runtime, add a throwaway `envprobe` script
to the app's `package.json` (plus an `"envprobe": { "cache": false }` task in
`turbo.json` so it never replays a cached result), and print **booleans, not
values**, so secrets never land in CI logs:

```jsonc
// portals/package.json — temporary, delete once diagnosed
"envprobe": "node -e \"console.log(JSON.stringify({dsn:!!process.env.VITE_SENTRY_DSN,portalDsn:!!process.env.PORTAL_VITE_SENTRY_DSN}))\""
```

```bash
VITE_SENTRY_DSN=x PORTAL_VITE_SENTRY_DSN=y pnpm turbo run envprobe --filter=portal
# {"dsn":true,"portalDsn":false}  ← PORTAL_ var stripped by strict env mode
```

Gotcha: the probe reads the env of **the task it is declared on**. `envprobe` has
its own `env` list (i.e. none), so it will keep reporting `false` for a var you
just fixed on `build` — that is not a regression. To verify the real fix, build
and grep the output instead:

```bash
PORTAL_VITE_SENTRY_DSN=https://sentinel.test/1 pnpm turbo run build --filter=portal --force
grep -rl "sentinel.test/1" portals/dist   # empty = the var never reached Vite
```

Delete the probe once diagnosed — it is a diagnostic, not a fixture.

## Common commands

```bash
# Dev (with Doppler)
doppler run -- pnpm dev              # portal dev server
doppler run -- pnpm dev:reports      # reports dev server
doppler run -- pnpm dev:website      # website dev server
doppler run -- pnpm dev:pwa          # pwa dev server

# Backend dev — local Postgres is the DEFAULT (needs Podman or Docker)
# Remote Neon costs 1.5-18s per authenticated request (Neon WS driver, not network).
pnpm --filter backend db:local:up     # start Postgres 17 on :5433, waits for healthy
pnpm --filter backend db:local:setup  # first time: migrate + seed RBAC + admin login
pnpm --filter backend dev:local       # backend on :3000 against the local DB
pnpm --filter backend db:local:reset  # wipe the volume and redo up + setup
# Login: admin@framada.app / password123 (fresh seeds since 2026-09-28 use admin@deneldental.com). See project-docs/local-dev-database.md.
# Engine: db:local:* uses Podman if installed, else Docker. Force with
# FRAMADA_CONTAINER_ENGINE=podman|docker. Same plain compose file for both.

# Backend dev — Neon fallback (no container engine)
cd backend
doppler run -- pnpm dev              # tsx watch (Node.js)
pnpm typecheck                       # tsc --noEmit
pnpm build                           # tsup (bundles workspace packages)

# Quality
pnpm lint             # Biome check (all apps)
pnpm lint:fix         # Biome check + auto-fix
pnpm format           # Biome format

# Build
pnpm build:all                       # Build all apps
pnpm turbo run build --filter=portal # Build specific app
```

## CI/CD

Defined in `.github/workflows/deploy.yml`. Branch-based:

| Branch | What happens |
|--------|-------------|
| `staging` push | Quality gates (lint, typecheck, test) → deploy to staging (Render, CF Pages staging) + staging DB migrations |
| `main` push | Quality gates → build backend image + push to GHCR → SSH to Hetzner (`docker compose pull`/`up -d`, then `migrate.mjs` — production migrations run **on the VPS**, as part of the deploy) + CF Pages prod |
| PR to `main`/`staging` | Quality gates only (no deploy) |

Promotion: merge `staging` → `main` via PR.

## Project docs

All technical documentation lives in `project-docs/`. Do not create new .md files in the root unless explicitly instructed.

| Document | Purpose |
|----------|---------|
| `project-docs/denel-rebrand-plan.md` | Framada→Denel Dental rebrand: current scope, brand colors/fonts, per-app rollout status, rename rules, local dev deviations |
| `project-docs/settings-domain-audit.md` | Settings domain audit (2026-09-23) + remediation S1–S6: KV registry with per-key gates, lookup integrity, decorative settings wired or removed, export/import hardening, key namespaces |
| `project-docs/pre-push-readiness.md` | Pre-push readiness check (2026-09-25): fresh-DB migration/drift/seed, CI gates, secrets (history NO-GO — push a fresh commit), `website/` decision, pipeline prerequisites |
| `project-docs/secrets-and-integrations.md` | Every secret, third-party credential and setup switch the system needs (2026-09-25): what to obtain, where it goes (Doppler / VPS / portal Integrations / GitHub), required vs optional, known traps |
| `project-docs/private-file-storage-design.md` | Private file storage design (built 2026-09-26, live-tested 2026-09-27): public bucket for branding only, private bucket for everything else, stored `private-file://` references (tagged with `PRIVATE_FILE_REF_SECRET`) turned into 1-hour signed links at the API edge and back |
| `project-docs/private-file-storage-plan.md` | Implementation plan for the private file storage design (2026-09-26/27; all 9 tasks executed, live R2 test passed): 9 test-first tasks, plus the execution records — review fixes, live-test findings and deferred minors |
| `project-docs/access-control-remediation.md` | Access-control fix (2026-09-24): Team-app bundle no longer opens the HR/payroll back office, per-user bundles scoped per app, portal access follows the role, portal refuses/explains, sidebar = guard |
| `project-docs/auth-security-audit.md` | Authentication security & architecture audit — every Critical/High fixed (2026-09-21) |
| `project-docs/auth-consolidation-plan.md` | Auth consolidation: staff stack onto Better Auth (decision 2026-09-21) |
| `project-docs/api-edge-topology.md` | API edge topology — Cloudflare Tunnel (app side done, infrastructure pending) |
| `project-docs/lookups_audit_report.md` | Lookups audit & master CSV specification (`master_lookups.csv` alongside) |
| `project-docs/neon-legacy-data-migration-runbook.md` | Runbook for the one-off legacy data migration from Neon |

> The earlier plan/tracker documents this table used to list (admin-v1, finance,
> HR, PWA split, launch readiness, …) are not in this clone; the table only
> names files that exist. Add a row when a doc is created.

## Architecture

### Packages (shared, no runtime deps)
- `@denel/rbac` — MODULES, ACTIONS, ROLES, MODULE_HIERARCHY, `can()` helper
- `@denel/types` — shared TypeScript interfaces, FinanceVisibilityConfig
- `@denel/utils` — `cn()`, GHS currency formatting, date helpers, GRA tax calculations, lookup slugs, tooth notation, and the shared readers of the CRM / petty-cash settings policies

### RBAC
- Roles: `admin`, `doctor`, `receptionist`, `lab_technician`, `staff`, `hr_admin`, `external_trainer`
- Permissions stored in DB (module + action pairs per role)
- Backend enforces via `checkPermission()` in `backend/src/lib/rbac.ts`
- Frontends load the permission payload from `/api/auth/permissions` (and app access from `/api/auth/scope-access`)
- `can()` in `@denel/rbac` is a pure helper for UI gating
- Where someone can sign in (portal, Team app `pwa`, HR `hr`) follows the role's scopes (`ROLE_SCOPES` in `@denel/rbac` mirrors `roles.config.ts`); `user_scopes` rows are per-person exceptions only
- Role bundles and per-user bundles apply only on the apps their scope covers (`applicableBundleScopes`)
- Team-app bundles grant only `dashboard` + the self-service tab modules (`my_payslips`, `my_requests`, `my_training`), never admin modules; `/api/staff`, `/api/hr`, `/api/hr3` and `/api/payroll` refuse Team-app sessions
- Portal route guard and sidebar share `portals/src/app/route-access.ts` — map every new route prefix there, or its page is denied and its link hidden
- See `project-docs/access-control-remediation.md`

### Reports visibility
- **Not implemented.** No backend route serves `finance_visibility` and no portal
  section writes it; `reports/lib/actions/finance-visibility.ts` calls a
  non-existent `GET /api/settings/finance-visibility` and falls back to
  "everything visible". Treat every report as visible until that feature is
  built (settings-domain-audit D7).

## Environment

- Runtime: Node.js 20, pnpm 9
- Build: Turborepo (replaces Nx)
- Backend bundler: tsup (bundles workspace packages inline)
- Linting/formatting: Biome 2.x (replaces ESLint + Prettier)
- TypeScript base config: `tsconfig.base.json` (Vite SPA apps extend this)
- CI/CD: GitHub Actions → Doppler (secrets) → CF Pages / Hetzner (GHCR + SSH) / Render

## portal structure

Feature-based architecture — a single, clean `src/` tree. (The old parallel
legacy trees — root `lib/`, root `components/`, `src/pages/`, `src/layouts/`,
`src/App.tsx`, and the Next.js-era maintenance scripts — were removed.)

| Directory | Notes |
|-----------|-------|
| `src/app/` | App shell, providers, router. Entry chain: `index.html` → `src/main.tsx` → `src/app/App.tsx` |
| `src/features/` | Feature modules (patients, appointments, payments, …) |
| `src/shared/` | Cross-cutting components + utilities |
| `src/lib/` | App utilities: API client, server-action wrappers, query keys, `modules.ts`/`utils.ts` re-exports of `@denel/*` |

- `@/` alias maps to `portals/src/` (handled by `vite-tsconfig-paths`); `@/lib/**` → `src/lib/**`
- tsconfig includes only `src`. The portal is a pure Vite SPA — no server/DB layer; all data flows through the backend API. DB seeding/admin tooling lives in `backend/src/scripts/` (`pnpm --filter backend seed:*`).

## team structure (the staff/clinical PWA — formerly `pwa/`)

The Team app is the internal, trusted-device PWA for **staff, doctors, and lab
technicians** (Better Auth). The patient self-service tree was extracted into a
separate `patient/` app (see below + `project-docs/pwa-split-patient-team-build-plan.md`).
It uses a **page-based** convention (different from portal's feature-based). New code goes in:

| Directory | Purpose |
|-----------|---------|
| `src/pages/` | Route components. Subdivided by role: `doctor/`, `lab/`, `staff/`, `auth/`, `requests/`. Top-level files (DashboardPage.tsx, MemosPage.tsx, etc.) are shared staff routes. (Patient pages moved to the `patient/` app.) |
| `src/layouts/` | Per-role layout shells (StaffLayout, DoctorLayout, LabTechLayout) |
| `src/components/ui/` | Mostly thin re-export shims of `@denel/ui` (4 still-local: badge/progress/select/textarea). Reconciliation deferred. |
| `src/components/training/` | Shared training viewers (TrainingModuleViewer, QuizViewer) |
| `src/lib/` | API client (api.ts — staff/lab only), staff auth (auth.tsx, auth-client.ts), branding |
| `src/shared/components/` | Cross-cutting components (AppErrorBoundary, OfflineBanner, RouteSkeleton, RequireRole, SWUpdatePrompt) |
| `src/shared/lib/` | Cross-cutting utilities (role-routing, error-reporting) |

- `@/` alias maps to `team/src/`
- Routes are lazy-loaded per role tree in `src/App.tsx` — main bundle excludes pages from other roles
- Each role tree is wrapped in `<RequireRole>` + `<AppErrorBoundary scope="...">` + `<Suspense fallback={<RouteSkeleton />}>`
- Wire protocol identifier is still `X-App-Id: pwa` (backend interface scoping); rename to `team` is part of the deploy-wiring slice.

## patient structure (the patient-facing PWA)

External, untrusted-device self-service PWA at `app.deneldental.com` (target). Phone+OTP auth
(`src/lib/patient-auth.tsx`, `X-App-Id: patient`), a single auth domain (`RequirePatient`
guard, no staff auth), and a slim `src/lib/api.ts` (generic client only). 8 patient pages
under `src/pages/patient/`, `PatientLayout`, interim `src/pages/auth/LoginPage.tsx` (replaced
by the passwordless phone+OTP + family-switcher flow in Phase 2). `@/` → `patient/src/`.
UI primitives come from `@denel/ui`. See `project-docs/pwa-split-patient-team-build-plan.md`.

## hr structure

Standalone HR-admin app (extracted from portal/pwa). Vite SPA, **desktop, email+password
login only** (not a PWA). Served at `hr.deneldental.com`; dev port **5176**. Logged in by
`admin` / `hr_admin` / `external_trainer` — all gated by the **`hr` interface scope**
(`RequireHrAccess` calls `/api/auth/scope-access?scope=hr`).

| Directory | Notes |
|-----------|-------|
| `src/app/` | Shell: `App.tsx`, `providers.tsx`, `router.tsx`, ported portal `layout`/`sidebar`/`header`/`mobile-nav` + `nav.ts` (static grouped `HR_NAV`) |
| `src/features/` | `staff/`, `tax-config/`, `tax-calculations/`, `integrations/` (Anviz), `auth/`, `dashboard/`, `staff-credentials/` |
| `src/pages/trainer/` | Training authoring (ported from the PWA trainer tree) |
| `src/lib/` | `auth` (`@denel/app-kit` `createAuth`), `api`/`api-client`, `actions/*`, `db/schema` (type re-export of backend), `modules`, `sanitize`, `utils` |
| `src/shared/` | `components/{data-table,*-dialog,...}`, `hooks/{use-permissions,use-form-dirty-guard,use-submit-guard}`, `lib/{dates,api-error,upload-blob,error-reporting}` |

- Built on **`@denel/app-kit`** (headless shell: `createApiClient`, `createAuth`, `createErrorReporter`, `AppErrorBoundary`, `RouteSkeleton`). `@/` → `hr/src/`.
- In dev, `vite.config.ts` points the API/auth base at the app's own origin so `/api` is proxied to the backend (no cross-origin CORS); production uses the real injected URLs.
- RBAC: `hr_admin` role (scope `['hr']`), `admin` also has `'hr'`, `external_trainer` re-scoped to `['hr']`. Seed via `pnpm --filter backend seed:rbac`. Backend `trustedOrigins` + `ALLOWED_ORIGINS` must include the HR origin per env.

## Important pre-existing issues (do not break)

- `website` has `@vitejs/plugin-react@5` with `vite@8` (peer dep warning — harmless, don't fix unless asked)

> **Typecheck is clean.** A forced, uncached `typecheck` across `backend`, `portal`,
> `hr`, `team`, `patient` and `reports` reports **0 errors** (verified 2026-09-25).
> `team` and `patient` run `tsc -b`: their root `tsconfig.json` only holds project
> references, so the old `tsc --noEmit` script checked zero files. The previously listed
> recharts `Formatter` errors in `src/features/analytics/` and
> `src/features/financial-analytics/`, and the `any` errors in the backend
> analytics routes, have been fixed and are no longer expected noise — **treat any
> new typecheck error as a real regression.**
>
> Lint is a different story: 0 errors, **2,036 warnings** (measured 2026-09-03 with
> `biome check .` per app: backend 1,334 · portal 535 · hr 88 · team 79 — the older
> ~1,861 figure predates `tests/` being covered by lint), dominated by
> `noNonNullAssertion` and `noExplicitAny`. That backlog is explicitly deferred
> (see T26-b in `project-docs/backend-frontend-consistency-remediation.md`) — do
> not bulk-suppress it, and do not add new ones.
