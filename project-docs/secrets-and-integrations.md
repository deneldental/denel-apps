# Secrets, integrations and API credentials (2026-09-25)

Everything that has to be obtained or generated before the whole system runs
and works end to end. Derived from the code — `backend/src/config/env.ts` and
every direct `process.env` read, `lib/integrations.ts`, each app's
`config/env.ts` and `vite.config.ts`, `render.yaml`, `.github/workflows/*.yml` —
not from older docs. No values are recorded here.

## Where credentials live

| Place | Holds |
|---|---|
| **Doppler** (project `denel`; configs `dev`, `stg`, `prd`) | Environment variables for the backend and for every frontend build. CI builds run under `doppler run`; Render syncs `stg` natively |
| **VPS `/opt/framada/.env`** | Production backend env. Every production deploy **merges Doppler `prd` into it**: keys Doppler defines win, keys only on the VPS are kept. The deploy aborts, leaving the running container untouched, if `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOWED_ORIGINS` or `PRIVATE_FILE_REF_SECRET` is empty after the merge |
| **Portal → Settings → Integrations** | Stored in the database, encrypted with a key derived from `BETTER_AUTH_SECRET`: Hubtel, R2, DO Spaces, Cloudinary, Google, Upstash, cron engine, backup, storage routing, branding, website booking keys. Where a service can also be set in env (Hubtel, Google), the Integrations screen wins |
| **HR app → Attendance Device** | Anviz (the portal's Anviz tile redirects here) |
| **GitHub → repository secrets** | Platform tokens for the workflows |

## 1. Third-party services

| Service | Used for | What to obtain | Where it goes | Needed |
|---|---|---|---|---|
| **Hubtel** (SMS) | Every SMS: Team and patient sign-in codes, appointment reminders, payment receipts, payment plans, bulk/birthday messages | Client ID, Client Secret (Hubtel → Messaging → Programmable SMS → API keys), and an **approved Sender ID** (max 11 characters, e.g. `Denel`; approval takes time — apply early) | Integrations → Hubtel. Doppler `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`, `HUBTEL_SENDER_ID` are only a fallback | **Required.** In production, sending throws without it |
| **Resend** (email) | Email to patients from CRM → Comms Health → Email (single and bulk) and the weekday aging-report digest to finance users. Staff "Forgot password" (portal, HR) uses SMS codes, not email | API key; the clinic's domain **`deneldental.com` verified** in Resend (DNS records at your DNS host); the From address `info@deneldental.com` | Doppler `RESEND_API_KEY`, `RESEND_FROM_EMAIL`; Integrations → Branding "email From address" on the same domain | **Required for any email** — none is sent without it |
| **Cloudflare R2** (default storage) | All uploads: X-rays, patient and staff documents and photos, logos, in-app backups | **Two buckets** — a *public* one (branding only: logo, favicon, icons, login photos) and a *private* one (everything else, no public access); one R2 **API token** with *Object Read & Write* on both (Access Key ID + Secret Access Key); endpoint `https://<account-id>.r2.cloudflarestorage.com`; the public bucket's **public URL** (r2.dev or a custom domain); region `auto`; the CORS rule in `private-file-storage-design.md` §4.7 on both buckets | Integrations → R2 (Public bucket, Private bucket, Public bucket URL) | **Required.** Uploads fail with "R2 is not configured", "Public URL is not configured" or "the private bucket is not configured". Private files are only ever served through signed links that expire 60–75 minutes after they are shown, and need `PRIVATE_FILE_REF_SECRET` (§3) |
| DigitalOcean Spaces | Alternative storage, chosen per file category | Region, endpoint, bucket, access key + secret, public URL | Integrations → DO Spaces | Optional |
| Cloudinary | Alternative image storage | Cloud name, API key, API secret | Integrations → Cloudinary | Optional |
| **Sentry** | Error tracking (all 5 frontends + backend now wired; deferred — no account yet) | An organisation, a project per app, their **DSNs**; an auth token for source maps | Backend `SENTRY_DSN`; builds `PORTAL_VITE_SENTRY_DSN`, `HR_VITE_SENTRY_DSN`, `VITE_SENTRY_DSN` (reports — shared name), `PWA_VITE_SENTRY_DSN` (team), `PATIENT_VITE_SENTRY_DSN`; source maps: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `PWA_SENTRY_PROJECT`, `PATIENT_SENTRY_PROJECT`, `VITE_GIT_SHA` (all in Doppler; declared in `turbo.json`) | **Required in production for all five frontends** — each refuses to start without a DSN when `VITE_APP_ENV=production` (2026-09-27: team, patient, reports gained this; reports is now actually wired). Optional for backend. Set `VITE_APP_ENV` per Doppler config so events are tagged dev/staging/prod correctly (fixed 2026-09-27 — was mis-tagging everything 'production') |
| Google Cloud | Google Calendar sync; Google Contacts sync | A project with the **Calendar API** and **People API** enabled; an OAuth consent screen; a **Web OAuth client** (ID + secret) with redirect URI `https://api.<domain>/api/google-calendar/callback` and the portal origin as an authorised JavaScript origin. For Calendar, a **service account** (email + private key) and a calendar ID also work | Integrations → Google (or `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`); portal build `VITE_GOOGLE_CLIENT_ID` (Contacts sync) | Optional |
| Anviz CrossChex Cloud | Attendance from fingerprint devices | API key, API secret, region (`us`, `eu` or `ap`); a webhook password you choose, set on both sides | HR app → Attendance Device | Optional (only with Anviz devices) |
| Upstash | External scheduler (QStash) and a lock so a job runs on one server only (Redis) | QStash token + current and next signing keys; Redis REST URL + token | Integrations → Upstash | Optional; not needed on a single server |
| Neon (or any hosted Postgres) | Staging database; target of the nightly GitHub backup | Connection strings | Doppler `stg` `DATABASE_URL`; GitHub secret `BACKUP_DATABASE_URL` | Needed for staging and off-site backups |
| Heartbeat monitor (e.g. Healthchecks.io) | Alert when the nightly backup stops running | A ping URL | GitHub secret `BACKUP_HEARTBEAT_URL` | Optional |
| Metricool | Website analytics | Tracking hash | Website `NEXT_PUBLIC_METRICOOL_HASH` | Optional (website only) |

There is no payment gateway: payments are recorded, not processed. The Paystack
and WhatsApp tiles in Integrations are placeholders.

**Hubtel notes (fixed 2026-09-25).**

- Sending, delivery-status checks and the Integrations test use the same keys —
  Integrations first, Doppler as the fallback (`getHubtelCredentials` in
  `lib/sms.ts`).
- A message goes out under the Sender ID set in Integrations → Hubtel unless a
  sender is chosen explicitly. CRM → Messaging's Bulk SMS form pre-fills its
  sender from Integrations → Branding, so keep the Branding SMS sender and the
  Hubtel Sender ID the same approved value.
- **Test** (Integrations → Hubtel) sends one real SMS to a number you enter,
  using one credit — Hubtel offers no free credential check.
- Hubtel publishes no balance API, so CRM → Comms Health → SMS Status points to
  the Hubtel dashboard (Messaging → Programmable SMS) instead of showing a figure.
- Checked against Hubtel: `sms.hubtel.com/v1/messages/send`,
  `…/messages/batch/personalized/send`, `…/messages/{id}` and
  `…/messages/batch/{id}` exist. The old balance address (`/v1/credit/balance`)
  and test address (`api-sms.hubtel.com`) did not.

**Resend notes (fixed 2026-09-25).**

- Every email goes out as the clinic: the From saved in Integrations → Branding,
  else `RESEND_FROM_EMAIL`, else `Denel Dental <info@deneldental.com>`
  (`getEmailFrom` in `lib/branding.ts`). That address must be on the domain
  verified in Resend (`deneldental.com`) or Resend rejects the send.
- The composer can only address patients who have an email on file — set it in
  Add Patient or Edit Patient (the fields were missing until 2026-09-25; a
  child's contact email is the Guardian Email). Portal emails are logged in
  `email_messages`.
- The backend also has an email password-reset endpoint (Better Auth
  `/api/auth/request-password-reset`, sent through `src/email.ts` and never
  recorded because the link is live), but no screen calls it: staff reset
  passwords with an SMS code.
- The aging digest only runs once the cron engine is on.

## 2. Hosting and pipeline accounts

| Service | Used for | What to obtain | Where it goes |
|---|---|---|---|
| **Doppler** | Secrets for every environment | Project `denel` with `dev`, `stg`, `prd`; a **service token** for `stg` and one for `prd` | GitHub `DOPPLER_TOKEN_STAGING`, `DOPPLER_TOKEN_PRODUCTION` |
| **GitHub** | Repository, Actions, container registry (GHCR) | The secrets below; a **personal access token with `read:packages`** so the VPS can pull the backend image | Repository secrets; one `docker login ghcr.io` on the VPS (the deploy runs `docker compose pull` there without logging in, and new GHCR packages are private) |
| **Cloudflare** | Pages for portal, team, patient, reports, hr; the website Worker; DNS; R2; the API tunnel | Account ID; an API token with Pages and Workers edit rights; a **tunnel token** (tunnel `denel-api`, see `api-edge-topology.md`) | GitHub `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`; VPS `.env` `CLOUDFLARE_TUNNEL_TOKEN` |
| **Hetzner VPS** | Production backend + Postgres | Host, SSH user, SSH private key. Write `/opt/framada/docker-compose.yml` yourself — backend image, Postgres, `cloudflared` — it is not in the repo (the `cloudflared` service is in `api-edge-topology.md` §2) | GitHub `HETZNER_HOST`, `HETZNER_USERNAME`, `HETZNER_SSH_KEY` |
| **Render** | Staging backend (`render.yaml`) | A deploy hook URL; the Doppler → Render sync, set up in Doppler | GitHub `RENDER_DEPLOY_HOOK_URL` |

Other GitHub secrets: `STAGING_API_URL`, `STAGING_PORTAL_URL`,
`STAGING_PWA_URL`, `STAGING_REPORTS_URL` (staging smoke tests) and `DATABASE_URL`
(the production database, for the nightly backup; GitHub's runners must be able
to reach it). `GITHUB_TOKEN` is automatic.

## 3. Secrets you generate yourself

| Secret | How | Where | Note |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` (at least 32 characters) | Doppler, a different one per environment | **Never change it once set.** It signs sessions and is the key for every credential stored in Integrations: changing it signs everyone out and makes those credentials unreadable until re-entered |
| `PRIVATE_FILE_REF_SECRET` | `openssl rand -base64 48` (at least 32 characters) | Doppler `dev` now; `stg` and `prd` before their next deploy | **Never change it once set, and keep it identical wherever the database is restored.** It signs the tag on every stored private-file reference (`private-file-storage-design.md` §4.2); only tagged references are ever turned into download links. Changing it makes every stored private file unviewable. Staging (Render) and production **refuse to start** without it, and the production deploy checks it before replacing the container; locally, private uploads fail, saves that carry a file answer "Private files are not set up on this server yet", and private files show as unavailable until it is set. If it ever changes, stored files stop showing **and** any record holding one can no longer be saved |
| `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME` | A strong password; your real admin email | Doppler `stg` and `prd` | The deploy fails without the password: `seed-admin` exits, and it **resets the admin password to this value on every deploy**. Defaults: `admin@deneldental.com`, `Admin` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npx web-push generate-vapid-keys`; subject a `mailto:` contact (defaults to `mailto:info@deneldental.com`) | Doppler **backend only** — no build-time key needed | Push notifications. Without the keys the backend silently skips push (and `GET /api/push/vapid-public-key` returns 409). **Both** the Team and patient PWAs fetch the public key from that endpoint at runtime (2026-09-27 — Team no longer bakes it in; `VITE_VAPID_PUBLIC_KEY` removed from both), so a key rotation needs only a backend restart, no rebuild |
| Production Postgres password | Chosen when creating the database on the VPS | VPS `.env` `DATABASE_URL`; GitHub `DATABASE_URL`; Integrations → Backup | — |
| Anviz webhook password | Random string | HR app → Attendance Device, and the Anviz webhook | Only with Anviz |
| Cron engine internal secret | Generated on first save if left blank | Integrations → Cron engine | Guards manual job triggers |
| Website booking key | Issued in Integrations → Website bookings | Website `WEBSITE_API_KEY` | Website only |

## 4. Settings that must be set (not secret)

- **Backend:** `DATABASE_URL`, `BETTER_AUTH_URL`, `ALLOWED_ORIGINS` (every
  frontend origin), `PORTAL_URL`, `PATIENT_PORTAL_URL`, and **`TRUSTED_IP_MODE`**
  — deployed backends refuse to start without it (`dryrun` until the tunnel is
  live, then `enforce`) — with `TRUSTED_IP_HEADER` (default `cf-connecting-ip`).
  `NODE_ENV=production` is baked into the Docker image; `render.yaml` also sets
  `APP_ENV=staging`. Optional: `CLINIC_NAME` (default "Denel Dental Clinic"),
  `CLINIC_PHONE`, `CLINIC_ADDRESS`, `PDF_TEMPLATE_BASE_URL`, SMS text overrides
  (`APPOINTMENT_SMS`, `PAYMENT_SMS`, `PAYMENT_PLAN_SMS`, `WELCOME_SMS`).
- **Frontend builds:** `VITE_API_URL`, `VITE_BETTER_AUTH_URL`, `VITE_APP_ENV`,
  each app's own URL (`PORTAL_VITE_APP_URL`, `HR_VITE_APP_URL`,
  `REPORTS_VITE_APP_URL`, `PWA_VITE_APP_URL`, `PATIENT_VITE_APP_URL`),
  `VITE_CLINIC_NAME`, `VITE_CLINIC_PHONE`, `VITE_CLINIC_ADDRESS`, and
  `VITE_CLINIC_BANK_DETAILS` / `VITE_CLINIC_MOMO_DETAILS` (payment instructions
  shown in Team and patient).
- **Website:** `BACKEND_URL`, `WEBSITE_API_KEY`.
- **In the portal, after the first sign-in:**
  - Integrations → **Cron engine: turn on the built-in engine.** Until it is
    saved, no background job runs — appointment reminders, no-show marking,
    overdue payment plans, CRM auto-queue, recare, task reminders, the in-app
    backup, audit retention, OTP/session and push cleanup, the aging digest,
    compliance reminders, lab fallback, lateness policy.
  - Integrations → **Storage routing** (every category defaults to R2).
  - Integrations → **Backup:** connection string, schedule, R2 or DO Spaces, and switch it
    **Enabled**. Backups go, privately and under an unguessable name, to the
    provider chosen as **Storage target** on the card (that choice used to be
    saved but ignored; fixed 2026-09-27). Test with
    Integrations → Cron engine → `backup-daily` → Run. Needs `pg_dump` 17 on the server:
    the production image installs it; locally it must be on the backend's PATH (a
    `gzip` program is not needed).
  - Integrations → **Branding:** clinic name, SMS sender, email From name and
    address.

## Notes

- **Staging sends real SMS.** The dev redirect applies only in development, and
  `render.yaml` sets `APP_ENV=staging`. With Hubtel keys in `stg`, messages go
  to the real numbers in the staging database; without them they are simulated
  and logged.
- **Local development** needs Doppler `dev` with the database, auth secret and
  URLs. It never texts a real recipient: with `SMS_REDIRECT_PHONE` (your own
  number) set in Doppler `dev`, every SMS goes there, prefixed
  `[Dev redirect from …]`; unset — or with no Hubtel keys — nothing is sent and
  the messages are printed in the backend console and logged as simulated.
  `SMS_STUB_FILE` captures messages to a file instead.
- **Before staging or production:** seed and smoke-test code still uses
  `0553424972` (not ours) as its test phone — `POST /api/seed/populate`
  (`src/routes/seed.ts`, admin-only), `scripts/seed-staging.ts`,
  `scripts/seed-test-phones.ts`, `scripts/smoke-test-sms.ts` (sends a real SMS)
  and `src/scripts/patch-test-patient-phone.ts`. Replace it first.
- The Sentry org + Team/patient project names come from Doppler
  (`SENTRY_ORG`, `PWA_SENTRY_PROJECT`, `PATIENT_SENTRY_PROJECT`) at build time,
  falling back to `framada-dental` / `framada-pwa` / `framada-patient` when
  unset (2026-09-27). At account-creation, set them in Doppler to your real
  Denel org/project names — no code change. Source-map upload only runs when
  `SENTRY_AUTH_TOKEN` is present; without it, maps still generate and are
  discarded (no upload).
- `backend/wrangler.jsonc` is unused; CI's `wrangler deploy` runs in `website/`.
