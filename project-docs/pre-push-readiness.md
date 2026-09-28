# Pre-push readiness check (2026-09-25)

Checked before the first push of this working tree (325 uncommitted paths on top
of `6033fe2f`) to a fresh remote that will run the production pipeline.

**Verdict: the code is ready; the git history is not.** Push the current tree
as one fresh commit, not this repository's history — the history contains live-
looking database credentials. A few decisions and pipeline prerequisites below
also have to be settled before the first push to `main` or `staging`.

## Go / no-go

| Area | Verdict | Summary |
|---|---|---|
| Fresh database from migrations | **GO** | All 227 migrations apply to an empty Postgres 17 (CI's `postgres:17-alpine`); CI's drift check reports no drift; the schema is identical to the long-lived dev DB; `seed-rbac` and `seed-admin` succeed |
| Full backend suite on that fresh DB | **GO** | 117 files, 1,238 tests pass (integration included) |
| CI quality gates, run as `deploy.yml` runs them | **GO** | Frozen lockfile, Biome (0 errors), lint ratchet, API contract audit (0 findings), typecheck of backend/portal/team/patient/hr/reports, backend build, `turbo run test --force` (7/7 tasks) |
| Secrets in the working tree | **GO** | None. The only hits are test fixtures (fake hosts) and a UI placeholder |
| Secrets in git history | **NO-GO** | Neon passwords and credentialed DB URLs, added or removed across 28 commits — see below |
| Tracked personal tool files | **Fix first** | `.claude/settings.local.json`, `.claude/scheduled_tasks.lock` |
| `website/` | **Decide** | Not rebranded; 139 MB of photos (26 files over 1 MB), several apparently of the original clinic's staff; a push to `main` deploys it to production |
| Pipeline prerequisites | **Set up first** | 15 GitHub secrets, Doppler service tokens, Cloudflare projects, VPS, Render — see below |
| Portal E2E smoke (CI step) | Not run locally | Needs the staging backend and Doppler `stg` |

## Fixed during the check

- **Lint ratchet** failed: backend 1,375 → 1,379 warnings. The six new
  `noNonNullAssertion`s came from earlier uncommitted work — four
  `getDb(process.env.DATABASE_URL!)` in the new `/balance-sheet`,
  `/period-summary`, `/period-list`, `/period-rollup` handlers of
  `routes/reports.ts` (now `env.DATABASE_URL`, the backend's usual form) and two
  in `scripts/backfill-legacy-billing.ts` (an unnecessary `!` on a nullable
  column; a guard mirroring the query's own `isNotNull`). Behaviour unchanged.
  The ratchet passes, and `lint-baseline.json` is locked at the lower counts:
  backend 1,373, portals 502, hr 1, team 78, patient 13, reports 268.
- **Team and patient `typecheck` checked zero files** (root `tsconfig.json` is
  references only, which `tsc --noEmit` ignores), so CI's "Typecheck — team /
  patient" steps were no-ops. Both scripts now run `tsc -b` — the check their
  build already runs; a planted type error now fails the step.
- **`appointment-type-reminders` integration test** borrowed "any row in
  `doctors`" and failed on every database without one — the fresh DB and the
  dev DB alike. It now creates its own doctor inside the rolled-back
  transaction.

## Secrets in git history

Values were never printed or recorded; only kinds and places.

- **Neon passwords (`npg_…`) and Neon/DigitalOcean URLs with credentials** in
  about 20 files across the history: one-off scripts (`backend/check_db_raw.ts`,
  `backend/fix-holy-lake.mjs`, seeds, `portals/check-dest.ts`, …), committed env
  files (`.env-all.local`, `reports/.env.local`), `project-docs/dev-env.md` and
  `stg-env.md`, `.claude/settings.local.json`, and — from this owner's own work —
  `scripts/neon-legacy-data-migration.sh` in `d5ad4287` (2026-09-21). None of
  these files, and no secret, is in the current tree.
- The two "private key" matches are placeholders (a UI hint and a 2-character
  stub in an old `.env.example`).

**Recommendation.** Start the new remote from a single fresh commit of the
current tree rather than pushing this history (e.g. `git checkout --orphan
fresh-main` + commit, or `git init` in a clean copy). Rewriting 676 commits to
scrub them is possible but error-prone. Either way, **rotate every credential
you own that ever appeared** — at least the Neon and VPS credentials used by the
legacy migration script. The original team's credentials in the old commits
are theirs; not publishing the history keeps them out of your repo.

## Tracked personal tool files

`.claude/settings.local.json` (a personal permission allow-list that once held
database URLs) and `.claude/scheduled_tasks.lock` are local Claude Code state.
Add both to `.gitignore` and leave them out of the fresh commit; keep
`.claude/settings.json` only if the project settings are meant to be shared.

## `website/`

The marketing site was excluded from the rebrand, so it still carries the
original clinic's name, domain and photography: 41 files and 139 MB in
`website/public` — nearly the whole repository by size. `deploy.yml` deploys it
on any push that touches `website/**` (production worker `website` on `main`,
`website-staging` on `staging`), and a fresh repository's first push can count
every file as changed. Options: keep it and accept that deploy, remove it from the first
commit until the Denel site is built, or disable its job until then.

## Pipeline prerequisites

A push to `main` runs the production deploy immediately (GHCR image, Hetzner
over SSH, migrations + seeds on the VPS, Cloudflare); `staging` deploys staging.
Pull requests only run the quality gates. Set these up first, or push to a
branch that deploys nothing (e.g. `dev`, PR-checked only) until they exist.

- **GitHub secrets (15):** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `DOPPLER_TOKEN_STAGING`, `DOPPLER_TOKEN_PRODUCTION`, `HETZNER_HOST`,
  `HETZNER_USERNAME`, `HETZNER_SSH_KEY`, `RENDER_DEPLOY_HOOK_URL`,
  `STAGING_API_URL`, `STAGING_PORTAL_URL`, `STAGING_PWA_URL`,
  `STAGING_REPORTS_URL`, and for the nightly backup workflow `DATABASE_URL`,
  `BACKUP_DATABASE_URL`, `BACKUP_HEARTBEAT_URL`. (`GITHUB_TOKEN` is automatic.)
- **Doppler:** service tokens for this project's (`denel`) `stg` and `prd`
  configs — the workflow never names a project; the token decides it.
- **Cloudflare:** Pages direct-upload projects `portal`, `team`, `patient`,
  `reports`, `hr`; Workers `website` / `website-staging` if the site stays.
- **Hetzner VPS:** Docker Compose at `/opt/framada` with its `.env`
  (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOWED_ORIGINS` are
  checked); the image is `ghcr.io/<owner>/framada-backend:latest`.
- **Render:** the staging service from `render.yaml`, env synced from Doppler
  `stg`.
- Infrastructure names (`framada-backend`, `/opt/framada`, `framada.app`) are
  deliberately unchanged — see the rename rules in `denel-rebrand-plan.md`.
- The full list — every third-party credential (Hubtel, Resend, R2, Sentry, …),
  self-generated secret and in-app switch — is in `secrets-and-integrations.md`.

## How the check was run

Throwaway `postgres:17-alpine` container on a spare port (removed afterwards);
`node migrate.mjs`, `db:drift`, `seed-rbac`, `seed-admin` and the full backend
suite against it; `pg_dump --schema-only` of it and of the dev DB diffed (only
pg_dump's random `\restrict` tokens differed). The dev database was not touched.
CI gates were run locally with the same commands as `deploy.yml`'s check job.
