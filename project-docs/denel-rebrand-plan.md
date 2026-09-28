# Denel Dental Rebrand Plan

**Status as of 2026-09-28.** This file is the single source of truth for the
Framada → Denel Dental rebrand. Update it as scope/status changes — don't let
it go stale the way `local-dev-database.md` did (see below).

## Context

This repo was cloned from a "Framada Dental" clinic-management template and
is being repurposed for the user's actual clinic, **Denel Dental Clinic**
(legal name "Denel Dental Limited" per the brand guide). This is NOT a
multi-tenant product — the end state is this repo belongs to Denel Dental
outright, so renaming things here permanently is correct, not a hack.

**"Framada" still appears throughout the codebase — package names
(`@framada/ui`, `@framada/utils`, `@framada/rbac`, `@framada/types`,
`@framada/assets`), domains (`framada.app`, `api.framada.app`), this repo's
own `CLAUDE.md`, seed data, etc. This is expected, not a bug** — the rename
is being done deliberately, in scoped passes, not as a blind find/replace.
Don't "fix" a stray "Framada" opportunistically while working on something
else; it's very likely intentionally deferred (see below for why).

## Current scope

**Branding: every app except `website/`** (owner's call, 2026-09-24). The
rename + brand pass done for `portals/` (colors, fonts, user-facing
"Framada" text, logos/favicons/PWA icons) now also covers `team/`,
`patient/`, `hr/` and `reports/`; see "Extension to team, patient, hr,
reports" below. Two things stayed out on purpose: the portal's redesigned
sign-in screens (`AuthLayout`: the split screen with the cross-fading photo
panel) are portal-only, so the other apps keep their own sign-in layouts and
only pick up the name, colors and fonts; and `website/` is now rebranded too
(2026-09-28, see "Website rebrand" below).

**Everything else: `portals/` first.** Bug fixes, architecture cleanup and
aligning to the clinic's real operations still happen in `portals/`
(admin/reception/doctor clinic management) incrementally; the other apps are
brought in one at a time. Update this section when that changes.

## Brand identity

Source: user-provided "Denel Dental Brandguide v1.0.0" PDF + logo files
(raw originals in `brand-assets-inbox/`, gitignored — not committed).

| Token | Value | Note |
|---|---|---|
| Navy (primary) | `#24296A` / HSL `236 49% 28%` | Sampled from actual logo files — **not** the brand guide's own written swatch (`#001472`), which doesn't match any shipped logo file and disagrees with its own RGB breakdown. Artwork wins; this was an explicit user decision. |
| Gold (accent) | `#B8873A` / HSL `36.7 52.1% 47.5%` | Sampled from the logo's gradient mark. Sparing accent per brand guide, not a fill color. |
| Font — body/UI | Montserrat (400/500/700) | Self-hosted via `@fontsource/montserrat` (repo convention: no Google Fonts CDN — see the note above the font imports in `portals/src/main.tsx`). |
| Font — headings only | Playfair Display (400/700) | Brand guide is explicit: never for body copy. `@fontsource/playfair-display`. |

Display name: **"Denel Dental Clinic"** (full), **"Denel"** (short — used for
SMS sender ID, 11-char limit).

## Rollout status per app

| Location | Colors | Fonts | Text rename | Logo/icons |
|---|---|---|---|---|
| `packages/ui/src/theme/base.css` (shared) | ✅ | — | — | — |
| `packages/ui/src/theme/dark.css` (shared, opt-in) | ✅ dark palette, used by `hr` + `reports` | — | — | — |
| `packages/assets/src/` (shared) | — | — | — | ✅ |
| `portals/` | ✅ | ✅ | ✅ (see exceptions below) | ✅ |
| `team/`, `patient/` | ✅ | ✅ | ✅ | ✅ |
| `hr/`, `reports/` | ✅ (+ OS-driven dark mode) | ✅ | ✅ | ✅ |
| `website/` | ✅ | ✅ | ✅ (real content = placeholders) | ✅ |

### Logos / favicons / PWA icons — done (2026-09-18)

Shipped files:

| File | What |
|---|---|
| `packages/assets/src/logo.png` | Horizontal lockup, 1600×398, transparent |
| `packages/assets/src/logo-icon.svg` | Two-tone mark (navy loop + gold loop), transparent |
| `packages/assets/src/logo-gold.png` | **Gold lockup for navy surfaces.** The supplied `Logo - Blue BG.png` with its flat `#24296A` ground lifted to alpha — the gold artwork itself is untouched. Recompositing over `#24296A` reproduces the source pixel-for-pixel (verified: max channel error 0.00). Use this whole on navy; do not set the clinic name in type beside it, the lockup already carries it. |
| `packages/assets/src/pwa/icon.png` | 512×512 app tile |
| `packages/assets/src/auth-slide-{1,2,3}.webp` | Auth panel photography, 1200×1560. 1 and 2 are the two usable photos embedded in the brand-guide PDF (extracted with `pdfimages`); 3 is a portrait crop of the existing `bg.webp`. They cross-fade on a slow Ken Burns cycle in `AuthLayout` — motion lives in `portals/src/globals.css` under `.auth-panel`. Replace with real Denel photography when it exists; same crop, same order. |
| `portals/public/logo.png` | Same lockup — used by printed receipts, invoices, prescriptions |
| `portals/public/app-icon.svg` (+ `favicon.svg`, `icon.svg`) | Navy tile, gold mark, rounded corners |
| `portals/public/favicon.ico` | Multi-res 16/32/48/64/128/256 |
| `portals/public/favicon.png` | 256×256 |
| `portals/public/apple-touch-icon-180x180.png` | Full-bleed square (iOS applies its own mask) |
| `portals/public/pwa-{64,192,512}.png` | Full-bleed square, fully opaque |
| `portals/public/maskable-icon-512x512.png` | Full bleed, mark at 55% — sits inside Android's 80% safe circle |

**These came from the brand-guide PDF's vector artwork, not the supplied PNGs.**
`pdftocairo` renders `brand-assets-inbox/Denel Dental Brandguide - v1.pdf` as
SVG/PNG with real paths, which is why the mark is crisp at 16px and the SVGs are
~7 KB. The rasters are rendered from `app-icon.svg` so the whole family is one
artwork.

`favicon.svg` and `icon.svg` are unreferenced leftovers (nothing in `portals/`
links them) but shipped to the CDN carrying Framada artwork, so they were
overwritten with the Denel icon rather than left stale. Safe to delete later.

**Deliberately crossed the portals-only scope line:** `packages/assets/src/` is
imported by `team/`, `patient/` and `hr/` too, so those three now render the
Denel logo instead of the Framada one. No code changed — the file swap is
enough, and leaving the wrong clinic's logo there had no upside.

### Two things the supplied artwork gets wrong (worked around, not "fixed")

1. **The navy differs between source files.** The PNG lockups export as
   `#24296A`; the icon PNGs and the whole PDF export as `#001472` (the guide's
   written swatch). Per the standing "artwork wins" call, the **lockup ships
   `#24296A`** — matching `--primary` and `theme-color` — so the PDF-rendered
   logo is recoloured navy→`#24296A` on the way out. The **icon tiles keep
   `#001472`**, the colour their own artwork ships with (explicit user call,
   2026-09-18). Favicon navy is therefore a touch brighter than app navy; they
   never appear adjacent.
2. **The supplied icon PNGs are squashed.** `Logo Icon/Asset 17.png` is 767×737
   for what is a square tile — a ~4% vertical squash on export, which the guide's
   own "Incorrect Usage" page forbids. Irrelevant now that icons come from the
   vector, but don't composite those PNGs directly without undoing it.

Still on raw artwork in `brand-assets-inbox/` (gitignored): nothing needed for
`portals/`. `website/` has had no icon pass. The unused Framada-era files in
`packages/assets/src/` (`framada-mark.svg`, `app icon dark.svg`,
`Customer App Icon.svg`) were **deleted 2026-09-27** (0 importers).

## Extension to team, patient, hr, reports — done (2026-09-24)

Owner's decisions: names mirror the old pattern, with the full clinic name for
the patient-facing app; HR and reports **keep an OS-driven dark mode** on a new
shared dark palette; the portal also gets the light-only dark-variant fix; the
portal's sign-in redesign is not copied; the unreferenced reports SMS screens
are left untouched.

| App | Tab title | PWA name / short name | theme-color |
|---|---|---|---|
| `team/` | Denel Staff | Denel Staff / Denel Staff | `#24296a` |
| `patient/` | Denel Dental Clinic | Denel Dental Clinic / Denel | `#24296a` |
| `hr/` | Denel HR (sidebar too) | not a PWA | `#24296a` |
| `reports/` | Denel Reports (header: "Denel") | not a PWA | `#24296a` |

- **Fonts.** Each app depends on `@fontsource/montserrat` and
  `@fontsource/playfair-display` (5.3.0, as the portal) and imports the same five
  CSS files in `main.tsx`; `--font-sans` / `--font-heading` / `--font-mono` are
  set in each app's theme block. Team's self-hosted Inter (`public/fonts/`, the
  preload, the `@font-face` blocks) and patient's Google Fonts Inter link are
  gone, and so are the Google Fonts allowances in team's and patient's CSP
  (`fonts.googleapis.com` in style-src, `fonts.gstatic.com` in font-src and
  connect-src): no code or built bundle loads from there, and the portal's CSP
  has none. The lockfile change is only the four importers' font entries. A
  plain `pnpm install` also moved the rollup peer of patient's
  `@sentry/vite-plugin` to 2.80 (below its `>=3.2` range) and churned unrelated
  hashes, so that was reverted: the lockfile is HEAD plus 24 lines, verified
  with `pnpm install --offline --frozen-lockfile`.
- **Colors.** `hr/` and `reports/` dropped their independent grey palette for
  `@framada/ui/theme/base.css` plus the new opt-in `@framada/ui/theme/dark.css`
  (exported by the package): navy-black grounds, a light periwinkle `--primary`
  (navy has too little contrast on a dark ground), gold lifted a step. Every text
  pair clears 4.5:1 (body 16.6:1, muted 8.3:1, primary buttons 8.4:1, destructive
  5.0:1). Their `dark:` utilities keep Tailwind's default media trigger, so they
  switch with the tokens. The portal got `@custom-variant dark (&:is(.dark *));`,
  the rule team/patient already had, so the portal's `dark:` utilities no longer
  fire over its light palette on a dark-mode OS.
- **Framada maroon `#3B1215`** (64 class uses across six team files, the shared
  bottom tab bar, the HR sign-in pill and buttons) → the theme's `primary`; the
  darker hover shades `#4f1a1e` / `#4E1C20` → `primary/90`. The tab bar's blush
  `#FDF5F2` → `background` and its maroon shadow → navy `rgba(36,41,106,0.12)`;
  the welcome card's coral sun glows → brand gold. Team's `BrandLoader` drew the
  Framada mark inline with animated coral, maroon and amber gradients; it now
  shows `@framada/assets/logo-icon.svg` with the same fade-in, float, glow (gold
  to navy) and navy/gold dots. Team's branding defaults (`themeColor`,
  `accentColor`) now match the backend's (`#24296a`, `#B8873A`).
- **HR sign-in card, dark mode:** shows `@framada/assets/logo-gold.png`, because
  the navy wordmark vanishes on the dark card; light mode keeps the navy lockup.
  Layout unchanged.
- **Icons** are byte copies of the portal's Denel family. Team/patient:
  `icons/icon.svg` (favicon), `icons/icon-192.png`, `icons/icon-512.png`, new
  `icons/maskable-512.png`, `icons/apple-touch-icon.png` (180); the manifests
  now declare 192 + 512 + maskable (the old single "512" entry was a 504×486
  Framada mark). HR: `favicon.svg`, `favicon.png` (256). Reports: `favicon.svg`,
  `icon.png` (256) and the receipt `logo.png` (the lockup; receipts scale it by
  `max-width`, so no distortion). Files nothing links but which ship with each
  build and carried Framada artwork were overwritten too, following the portal's
  precedent: `favicon.svg`, `icons/apple-touch-icon.svg` and `logo.png` in
  team/patient, `icon.svg` and `logo.png` in HR, `icon.svg` and `favicon.png` in
  reports.
- **Text.** Page titles, meta descriptions, iOS titles, PWA manifest names,
  push-notification default titles, install banners, the loader label,
  `logoAlt`s, clinic-name fallbacks (`VITE_CLINIC_NAME` defaults, payslips,
  receipts), the HR copyright line, team's employment-consent sentence, patient's
  statement download name (`denel-statement.pdf`), test-notification titles and
  team's e2e smoke assertions (title and manifest name) plus reports' (title).
  Reports also showed the template's name "Mini Clinic" (Settings → Profile, and
  the financial-records "Official Receipt" heading); those, plus its receipt and
  patient-detail fallbacks, read `NEXT_PUBLIC_CLINIC_NAME`, which Vite never
  exposes (`envPrefix: 'VITE_'`). All now read `VITE_CLINIC_NAME`, falling back
  to "Denel Dental Clinic". Storage keys `framada:quiz-draft:*`,
  `framada:quiz-pending` (team) and `framada:hr:staff-wizard:draft` (HR) →
  `denel:…`; drafts saved under the old keys are not carried over (nothing is
  deployed from this clone).

**Left alone deliberately:** domains and external ids: the `framada.app` API
hosts in each app's CSP (`public/_headers`), team Profile's "website" button
(`https://framadadental.com`), reports' receipt QR link and
`www.framadadental.com` line (the portal's receipts carry the same QR link), and
`SENTRY_ORG` / `SENTRY_PROJECT` in team/patient. Also left: (the reports SMS screens
`components/messaging/*` + `lib/actions/sms.ts` — unreferenced dead code — were
**deleted 2026-09-27**); `reports/lib/db/schema.ts`'s `from` default and
`reports/lib/env.ts`'s `SMS_SENDER_NAME` (the backend's `'Framada'` SMS-sender
sentinel, see below); (the `@framada/*` package names and `FramadaAuth` type were renamed 2026-09-27, see below);
code comments and test fixtures (`*@framada.app` users); a chart palette's
violet `#8b5cf6` (a data colour, not the old accent); unused template leftovers
in team/patient (`public/icons.svg`, the 4 MB `public/pwa-bg.jpg`).

**Found along the way, outside this pass:**
- *Fixed 2026-09-24* (access-control-remediation.md): HR showed "No HR access"
  right after a fresh sign-in until Retry or a reload — the page-load scope
  check, made while signed out, was cached and reused after sign-in.
- *Fixed 2026-09-25* (pre-push-readiness.md): the `team/` and `patient/`
  `typecheck` scripts checked zero files — their root `tsconfig.json` is
  `files: []` plus references, which `tsc --noEmit` doesn't follow. Both now run
  `tsc -b`, the same check their build runs.
- *Fixed 2026-09-27:* Reports' shared receipt (`lib/utils/receipt.ts`) and
  patient detail read `NEXT_PUBLIC_CLINIC_PHONE` / `_ADDRESS`, which Vite never
  exposes, so they never printed a phone/address. Now read `VITE_CLINIC_PHONE` /
  `_ADDRESS` (already in reports' env schema). The receipt website line's
  `NEXT_PUBLIC_CLINIC_WEBSITE` → `VITE_CLINIC_WEBSITE` (added to the schema); its
  hardcoded `www.framadadental.com` fallback dropped to empty — set the real
  value once the website domain is decided.
- `reports/scripts/send-test-email.ts` sends to the Framada clinic's Gmail
  address when `TEST_EMAIL_TO` is unset. No package script runs it.
- Each PWA now precaches 344 KiB of brand fonts (23 woff2 files, the portal's
  full-subset choice) against 130 KiB of Inter before. Dropping the cyrillic and
  vietnamese subsets would save about 125 KiB; latin-ext has to stay, because its
  range covers the ₵ in every GH₵ amount.

Verification: typecheck clean for portal, hr, reports, `@framada/ui`, and
team/patient via `tsconfig.app.json`; unit tests portal 172/172, team 35/35,
reports 19/19 (patient has none); production builds of team, patient, hr,
reports and the portal succeed; Biome 0 errors and no warning growth on any
touched file; HR checked in the browser in light and dark mode (sign-in and
dashboard). Team, patient and reports were not opened in a browser.

## The clinic name on screen comes from the **backend**, not the frontend

The trap: grepping `portals/` for "Framada" and finding it clean does **not** mean
the UI says Denel. The sidebar, SMS sender, email From, receipt/PDF headers and
the appointment-calendar accent colours all read `GET /api/integrations/branding`,
which resolves `integration_branding` KV → env (`CLINIC_NAME`, `HUBTEL_SENDER_ID`,
`RESEND_FROM_EMAIL`) → **literal defaults in `backend/src/lib/branding.ts`**. The
frontend's own defaults in `portals/src/lib/branding-context.tsx` only show for
the first paint before the fetch resolves.

Fixed 2026-09-18 — backend literal defaults are now Denel (`shortName: 'Denel'`,
`name`/`copyrightHolder` `'Denel Dental Clinic'`, `smsSenderId: 'Denel'`,
`emailFromName: 'Denel Dental'`), plus `accentColor` `#8b5cf6`→`#B8873A` and
`themeColor` `#16a34a`→`#24296a`, which were template-leftover purple/green
painting the appointments calendar. Also renamed every user-facing fallback and
message body found by `grep -rn Framada backend/src`: `scheduler`, `staff-otp`,
`patient-otp`, `staff-registration`, `pdf-handlers`, `employee-data-sheet`,
`aging-digest`, `google-service-account`, `patient-portal` (incl. the push-test
title), `appointment-workflow`, `patients` (patient-app-access SMS),
`payment-plans`, `reminders` (payment-reminder SMS), `staff-core`,
`staff-portal`, `staff-attendance`, `xrays` (X-ray share SMS), the OpenAPI
title, and the env defaults in `config/env.ts` / `lib/env.ts`.

**Two renames that would have been silent breakage if done literally:**

- **SMS sender.** `sms.ts` treats the bare string `'Framada'` as a sentinel
  meaning "use the admin-configured sender". Renaming it to `'Denel'` at a call
  site turns it into an explicit caller value that overrides the sender ID admins
  set in Settings. All eight `sendSMS` call sites now pass `undefined` and defer
  to `sendSMS`'s own Hubtel-KV → branding resolution; the sentinel is kept for
  legacy callers.
- **Google Calendar tag.** Event descriptions embed `Framada appointment <uuid>`,
  now `Denel appointment <uuid>`. Safe only because the recovery lookup queries
  `events?q=<uuid>` on the bare UUID — it never matches the prefix — so existing
  events still resolve. Don't "simplify" that lookup to search the prefix.

**Two places still say Framada and need data, not code:**

- `consent_form_templates` "Patient App Access" — `ensureAppConsentTemplate()`
  returns the existing row and never updates it, so any environment that already
  created the template keeps the old patient-facing text. (Not present in the
  local dev DB, so it will be created correctly there.)
- ~~`communications.from` column default is `'Framada'`~~ — **fixed 2026-09-25**
  by migration `0228_denel_comms_from_defaults`: `sms_messages.from` now
  defaults to `'Denel'` and `email_messages.from` to
  `'Denel Dental <info@deneldental.com>'` (schema in `db/schema/comms.ts`). The
  app always writes `from`, so these only apply to rows inserted by hand.

## Rename rules established (apply these in future passes)

Renamed freely: user-facing text (UI copy, PWA manifest name, page titles,
receipt/SMS/PDF template strings, settings placeholder examples, branding
config defaults, localStorage key prefixes, leftover pre-rebrand hex colors
like old `theme-color` meta tags).

**Clinic email decided (2026-09-25): `info@deneldental.com`.** Every place the
template address `clinic@framada.app` stood for the clinic's email now uses it:
the backend branding fallback (`lib/branding.ts`), the email senders
(`src/email.ts` for password resets, `lib/email.ts` for portal/digest mail —
both through `getEmailFrom`), the legacy `EMAIL_FROM` default (`lib/env.ts`), the
comms column defaults (migration 0228), the portal's first-paint branding
default and the Branding card's placeholder. This is the email domain only —
where the apps will be hosted is still open.

**App hosting domain — DECIDED + DONE 2026-09-28** (`deneldental.com`; see the
"Domain rebrand" section below). This paragraph's old TODOs — the CSP
`connect-src` allowlist, the `HR_APP_ORIGIN` redirect constant, the OAuth/API-URL
placeholder examples, the seeded login `admin@framada.app`, and the OpenAPI
contact `dev@framadadental.com` — are all done. (The push VAPID subject was
already `info@deneldental.com` from the push setup.) The Google-permissions-removal
instruction text describes Google's own UI and is left as-is.

**Package rename DONE 2026-09-27**: `@framada/*` → `@denel/*` (all 6 packages —
`app-kit, assets, rbac, types, ui, utils` — their `package.json` names, plus 425
files: imports across every app, CSS `@import`s, workspace deps). pnpm-lock
regenerated (`pnpm install`); `pnpm-workspace.yaml` is path-based so needed no
change. `FramadaAuth` type → `DenelAuth`. Verified: turbo typecheck 10/10, build
7/7, test suites pass. CLAUDE.md's package-name references updated to match.

## Domain rebrand DONE 2026-09-28

Single domain **`deneldental.com`** (Cloudflare) — the two old domains
`framada.app` (apps) + `framadadental.com` (marketing + reports) collapse into it.

| App | Host |
|---|---|
| website (marketing) | `deneldental.com` (+ `www` → apex) |
| patient | `app.deneldental.com` |
| portal | `portal.deneldental.com` |
| team | `team.deneldental.com` |
| hr | `hr.deneldental.com` |
| reports | `reports.deneldental.com` |
| backend API | `api.deneldental.com` |

`app.` (patient) and `reports.` were the owner's calls; the old patient host was
the bare apex, now taken by the marketing site.

**Code changed** (verified: typecheck 10/10; backend 1037 / portal 269 / team 38 /
reports 22 pass; lint ratchet flat at every baseline; API contract audit 0):
- **Cookie / same-site — one source of truth.** New `backend/src/lib/same-site.ts`
  holds `APP_BASE_DOMAIN='deneldental.com'`, `COOKIE_DOMAIN='.deneldental.com'`,
  `isAppDomainHost()` (registrable-domain boundary — so `notdeneldental.com` and
  `deneldental.com.evil.test` are NOT matched, a tightening over the old bare
  `endsWith('framada.app')`) and `sharesSiteWithBackend()`. **Both** cookie paths —
  Better Auth's session cookie (`auth.ts`) and the CSRF double-submit cookie
  (`csrf.ts`) — import from it, so the session and CSRF cookie domains can't drift.
  5 new unit cases in `auth-hardening.test.ts` (prod same-site, pages.dev/Render
  cross-site, http, lookalike).
- **Interface map** (`detectInterface.ts`): production origins → `portal./team./hr.
  deneldental.com`; the `*-stage.framada.app` staging customs dropped (staging keeps
  the generic `staging.*.pages.dev` aliases); `INTENTIONALLY_UNMAPPED` is now the
  single substring `deneldental.com` (covers apex + app. + reports.).
- **CSP `connect-src`** in all 5 `public/_headers`: the three framada API hosts →
  the single `https://api.deneldental.com`.
- **Patient-facing link fallbacks** (`appointment-workflow.ts`, `xrays.ts`,
  `patients.ts`): `https://framada.app` → `https://app.deneldental.com`.
- **Seed admin** (`seed-admin.ts`): `admin@framada.app` → `admin@deneldental.com`
  (owner's call). **Fresh seeds only** — an already-seeded DB keeps the old row
  until re-seeded, so the current local login is unchanged until then.
- **`HR_APP_ORIGIN`** (`portals/src/app/modules/specialists.tsx`) →
  `https://hr.deneldental.com`.
- **OpenAPI** (`openapi-spec.ts`): contact `dev@deneldental.com`, prod server
  `api.deneldental.com`, framada staging server dropped.
- **Receipts / QR / website links** (portal + reports receipt files, team Profile
  "website" button): `framadadental.com` → `deneldental.com`.
- **Integration-card placeholders** (upstash, google-oauth, website-bookings,
  branding).
- **Legacy `wrangler.jsonc`** (inert — backend runs on VPS/Render, not Workers):
  domain vars swapped for consistency; non-domain stale values (HUBTEL_SENDER_ID
  `Framada`, the SMS-template phone) left for a name/data pass.
- Comments across auth/csrf/session-cache/rbac/verifySession/env/branding/app-kit.

**Doppler values to set at DEPLOY time** (prd + stg — NOT needed for local dev,
which is all localhost):
- `BETTER_AUTH_URL` = `https://api.deneldental.com` (backend `trustedOrigins`
  auto-derives from `ALLOWED_ORIGINS`).
- `ALLOWED_ORIGINS` = `https://portal.deneldental.com,https://team.deneldental.com,https://hr.deneldental.com,https://app.deneldental.com,https://reports.deneldental.com,https://deneldental.com`
- shared `VITE_API_URL` / auth base = `https://api.deneldental.com`.
- each app's own-URL var (`PORTAL_VITE_*`, `PWA_VITE_*`, `PATIENT_VITE_*`,
  `HR_VITE_*`, `REPORTS_VITE_*`) = its host above.
- `PORTAL_URL` = `https://portal.deneldental.com`, `PATIENT_PORTAL_URL` =
  `https://app.deneldental.com`, `VITE_CLINIC_WEBSITE` = `https://deneldental.com`.

**Deferred (not domains, or need infra that doesn't exist yet):**
- **Cloudflare wiring**: no Pages projects exist yet (fresh account, verified). Each
  subdomain attaches to its app's Pages project at deploy; `api.` is a manual DNS
  record to the backend host (VPS/tunnel) once stood up.
- **Staging CSP**: add the Render staging API host to the 5 `_headers` when staging
  exists (prod host is the only one baked now).
- **Sentry org/project slugs** (`framada-dental`/`framada-pwa`/`framada-patient` in
  team + patient `vite.config.ts`) — set when the Sentry projects are created.
- **`website/`** full pass (its own domain is the apex) — untouched.
- **Name (not domain) leftovers**: `framada-statement.pdf` filename
  (`patient-portal.ts:723`), `@framada.local` kiosk pseudo-email (`kiosk.ts:855`),
  `seed-staging.ts` demo data, `backend-openapi.json` orphaned dump, test fixtures
  (`@test.framada.app`; `access-management.test` deliberately relies on "framada"
  containing "ama"), `/opt/framada` VPS path, Neon DB names (`framada-dev`), Doppler
  `framada-projects` (this clone uses `denel`).

## Website rebrand DONE 2026-09-28

`website/` (the Next.js marketing site) was the last app still on Framada. It was
NOT a blank template — it was the original clinic's live site, populated with
their real people and facts. Rebranded to Denel, with every original-clinic real
datum stripped to an honest placeholder (owner's call: "placeholder for now").

**Brand system:** Geist fonts → Montserrat (body) + Playfair Display (headings)
via `next/font` (self-hosted at build); the gold-led palette + Framada maroon
`#301112` → Denel navy `#24296A` primary + gold `#B8873A` accent (globals.css
tokens + a repo-wide hardcoded-hex sweep: `#E2A343`→`#B8873A`, `#301112`→`#24296A`,
cream `#FFF1DB`/`#FFF7EA`→`#F6EFE1`, etc.); `next.config.ts` CSP `connect-src` →
`https://api.deneldental.com`; metadata title + `metadataBase` → Denel.

**Original-clinic real content REMOVED → placeholders:**
- **Team** (`team-section`, `team-grid-section`): 10 named staff with photos +
  real LinkedIn → "coming soon"; photos deleted.
- **Testimonials**: 6 named reviews → placeholder.
- **Statistics**: fabricated "2,500+ / 98% / 12+ / 3+ years" → placeholder.
- **Our Story**: "founded 2022 by Dr. Jemima …" → generic Denel copy (no invented
  founder/date).
- **Insurance partners** (`logos-section`): Glico/ACE/Nationwide/MH → placeholder.
- **Contacts** (footer, contact, scan, privacy, terms): Kumasi address, two `+233`
  phones, WhatsApp, six `@framadadentalgh` socials, the Google-review link and the
  YouTube embed → placeholders; email → `info@deneldental.com`.

**Assets:** Framada `logo.png`/`logo-white.png` → Denel lockups (`packages/assets`);
`app/favicon.ico` → Denel; the 13 staff portraits + 4 orphan photos + insurer logos
+ create-next-app SVGs deleted. **`website/public` 139 MB → 59 MB.**

**Kept (FLAG):** the `bg01–08.jpg` / `about*.{jpg,webp}` backdrops (the remaining
59 MB) are the ORIGINAL clinic's premises photos, kept only so pages aren't
image-less — replace with Denel's own before going live.

**Owner must supply later** (the "coming soon" spots): real staff (names + photos),
testimonials, stats, contact details (address, phone, hours, social handles), and
the backdrop photos.

**Verified:** `tsc --noEmit` 0 errors; Biome 0 errors (11 pre-existing warnings);
`next build` succeeds (23 routes); full-website grep for `framada` /
original-contacts / Framada hex = zero.

## Local dev deviates from CLAUDE.md's documented setup

This clone doesn't have access to the original team's Doppler project,
Neon DB, or Hetzner VPS, so local dev was set up independently:
- Doppler project is **`denel`** (not `framada-projects`), `dev` config,
  linked via `doppler setup` at the repo root. Same var names as documented
  elsewhere in CLAUDE.md.
- Local Postgres via Docker (`pnpm --filter backend db:local:up` /
  `dev:local`) rather than the remote Neon dev branch.
- Seeded login: `admin@framada.app` / `password123`.
- Note: `project-docs/local-dev-database.md`, which CLAUDE.md's docs table
  references for the general local-Postgres workflow, doesn't actually exist
  in this clone. This file covers the Denel-specific deviation only.
