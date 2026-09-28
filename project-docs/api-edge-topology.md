# API edge topology — Cloudflare Tunnel

**Decision date:** 2026-09-21 · **Status:** app side done, infrastructure side
pending. Addresses C2 in `auth-security-audit.md`.

## Why this exists

The backend derived the caller's address from `CF-Connecting-IP`, falling back
to `X-Forwarded-For`. Both are ordinary request headers that any direct caller
can set, so every control built on them was decorative:

- Rotating the header gave a fresh rate-limit bucket per request. The
  `/sign-in/email` limit of 5/min never fired — **verified**, 8 attempts, zero
  429s.
- Omitting it collapsed every caller into one shared `'unknown'` bucket, so a
  single client could exhaust the limit for everyone.

You cannot fix this inside the application. A header is only trustworthy if
something you control set it and nothing else can reach the origin. That is a
topology property.

## Target

```
  Browser
     │ https
     ▼
  Cloudflare edge ──── WAF + edge rate limiting on /api/auth/*
     │                 sets CF-Connecting-IP (authoritative, overwritten)
     │ outbound-only tunnel ── VPS opens no inbound port
     ▼
  cloudflared (container, same compose project)
     │ http, docker network only
     ▼
  backend:3000 ── no published port
     │
     ▼
  Postgres (already local)
```

Two properties make it work:

1. **Unbypassable** — the origin publishes no port, so there is no path that
   skips the edge. Nothing to firewall, no Cloudflare IP ranges to track as they
   change, and no origin IP that matters if it leaks.
2. **Overwriting** — Cloudflare sets `CF-Connecting-IP` from the connection it
   terminated, replacing anything the client sent. Most `X-Forwarded-For` bugs
   are proxies that *append* instead of replacing.

Chosen over an IP allow-list with Authenticated Origin Pulls because it removes
the ongoing maintenance rather than adding some, which matters for a clinic with
no dedicated ops. The trade is a dependency on Cloudflare availability and one
long-lived tunnel token to rotate.

## The header contract

**`CF-Connecting-IP` is the only identity header the application reads.** No
fallback chain, ever. Both readers are pinned to the same env var so they cannot
drift apart:

| Reader | Setting |
|---|---|
| `lib/rate-limiter.ts` → `clientIp()` | `TRUSTED_IP_HEADER`, default `cf-connecting-ip` |
| Better Auth's own limiter | `advanced.ipAddress.ipAddressHeaders` — same value |

Better Auth's default was `['x-forwarded-for']`, which is what the bypass
exploited. Note it **fails open**: when no listed header matches, `getIp()`
returns null and rate limiting is skipped with a warning rather than denying. So
a misconfigured header silently disables its limiter — check the readiness
verification below after any change.

The application's own `requireClientIp()` fails *closed* instead, governed by
`TRUSTED_IP_MODE`:

| Value | Behaviour |
|---|---|
| `enforce` | **default** — reject a request whose address cannot be established |
| `dryrun` | log it, allow it, give it a per-request key so it cannot share a bucket |
| `off` | allow silently |

Local development is unaffected either way: a request whose socket peer is
loopback is trusted, and no remote attacker can forge that.

## Deployment order — this matters

**Stand the tunnel up first, then deploy the application change.**

With nothing in front of the origin, no request carries `CF-Connecting-IP`, so
`TRUSTED_IP_MODE=enforce` would reject every public request — the website
booking intake and the appointment confirmation links.

If the application ships first, set `TRUSTED_IP_MODE=dryrun` in Doppler `prd`
before the deploy and remove it once the tunnel is verified.

> Do not leave it on `dryrun` indefinitely. `SCOPE_ENFORCEMENT` in this codebase
> defaulted to `dryrun`, was set in no env file and no CI config, and therefore
> enforced nothing anywhere for its entire life. Same trap.

### This is now enforced at boot, not by this paragraph (2026-09-21)

The advice above was the whole control: a comment in a markdown file and another
in `lib/rate-limiter.ts`. `TRUSTED_IP_MODE` was set nowhere, so a deploy would
have inherited `enforce` with no tunnel in front and rejected every public
request — discovered only by the website booking form going dark.

`config/env.ts` now declares `TRUSTED_IP_MODE` and `TRUSTED_IP_HEADER`, and
`assertTrustedIpConfigured()` **refuses to start** a staging or production
instance where `TRUSTED_IP_MODE` is unset. Development is exempt: `clientIp()`
falls back to a loopback peer, and a developer reaching the box on a LAN address
should not be blocked from booting.

So the ordering decision now has to be made once, explicitly, in Doppler — it
can no longer be skipped by not reading this file.

## Steps

### 1 — Cloudflare

1. Zero Trust → Networks → Tunnels → **Create a tunnel** (Cloudflared).
2. Name it (`denel-api`), copy the **tunnel token**.
3. Public hostname: `api.<domain>` → **Service** `http://backend:3000`.
   The service name is the compose service, resolved on the docker network.
4. Confirm the DNS record Cloudflare creates is **proxied** (orange cloud).

### 2 — VPS, `/opt/framada/docker-compose.yml`

Stop publishing the backend port and add the tunnel:

```yaml
services:
  backend:
    # ports:            ← remove entirely. Nothing outside the compose
    #   - "3000:3000"     network needs to reach it any more.
    expose:
      - "3000"
    environment:
      TRUSTED_IP_HEADER: cf-connecting-ip
      TRUSTED_IP_MODE: enforce

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      - backend
```

Put `CLOUDFLARE_TUNNEL_TOKEN` in the compose environment on the VPS, alongside
`DATABASE_URL` (production secrets live on the server — see CLAUDE.md).

### 3 — Firewall

Once the tunnel serves traffic, close inbound `80`/`443`/`3000` on the VPS. The
tunnel is outbound-only; nothing needs to reach in. Keep SSH restricted to the
addresses you deploy from.

### 4 — Edge rate limiting (optional, recommended)

A WAF rate-limiting rule on `/api/auth/*` absorbs volume at the edge before it
reaches the VPS at all. The application limits still matter — this is the outer
layer, not a replacement.

## Verification

After cutover, from outside the network:

```bash
# 1. the header arrives and is authoritative — a spoofed value must NOT win
curl -s https://api.<domain>/api/health -H 'CF-Connecting-IP: 1.2.3.4'

# 2. rate limiting actually engages (it must NOT be silently skipped)
for i in $(seq 1 8); do
  curl -s -o /dev/null -w "%{http_code} " -X POST \
    https://api.<domain>/api/auth/sign-in/email \
    -H 'Content-Type: application/json' \
    -d '{"email":"nobody@example.invalid","password":"wrong"}'
done
# expect: 401 ×5 then 429.  All 401s means getIp() is returning null and
# Better Auth is failing open — the header name does not match.

# 3. the origin is unreachable directly
curl -m 5 http://<vps-ip>:3000/api/health   # expect: connection refused/timeout
```

Check the backend logs for `Rate limiting skipped: could not determine client IP`
— if that appears, the contract is broken even though requests still succeed.

## Rollback

Republish the backend port and reopen the firewall; set `TRUSTED_IP_MODE=off`.
The application keeps working, with the original weakness. No schema or data
change is involved, so rollback is config-only.

## What this does not fix

A perfect trust boundary does not stop a distributed attempt — every request
there carries a genuine, different address. That is handled independently by the
per-account throttle in `lib/login-limiter.ts`, which is keyed on the identifier
and applies wherever the attempt comes from. It is already deployed and does not
depend on any of the above.
