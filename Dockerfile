# ── Stage 1: Build ─────────────────────────────────────────────────────────────
# Full monorepo install so tsup can resolve @framada/* workspace packages, then
# `pnpm deploy` bundles a self-contained production directory at /deploy that
# has only backend's production node_modules (no workspace resolution issues in
# the runner stage, no devDependencies).
FROM node:20-slim AS builder
WORKDIR /repo

RUN npm install -g pnpm@9

# Skip puppeteer's bundled Chrome download — the runner uses system Chromium.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Manifests first — unchanged manifests = Docker layer cache hit on deps.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/rbac/package.json   packages/rbac/
COPY packages/types/package.json  packages/types/
COPY packages/utils/package.json  packages/utils/
COPY backend/package.json \
     backend/tsup.config.ts \
     backend/tsconfig.json \
     backend/worker-configuration.d.ts \
     backend/migrate.mjs \
     backend/

RUN pnpm install --frozen-lockfile

# Source — after deps so a code-only change reuses the install cache layer.
COPY packages/ packages/
COPY backend/src/ backend/src/
COPY backend/migrations/ backend/migrations/

# Bundle: tsup inlines @framada/* packages so the output is a single CJS file.
RUN pnpm --filter backend build

# pnpm deploy creates a self-contained directory with real (non-symlinked)
# production node_modules — no workspace lookup needed in the runner.
RUN pnpm --filter backend deploy --prod /deploy

# Overlay the tsup-built dist/ and migration script on top.
RUN cp -r /repo/backend/dist /deploy/dist && \
    cp /repo/backend/migrate.mjs /deploy/migrate.mjs && \
    cp -r /repo/backend/migrations /deploy/migrations


# ── Stage 2: Production runtime ─────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

# System Chromium for puppeteer (PDF / screenshot routes).
# PUPPETEER_SKIP_CHROMIUM_DOWNLOAD stops puppeteer bundling its own Chromium
# during install; PUPPETEER_EXECUTABLE_PATH points it at the system binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

# PostgreSQL 17 client tools, for the in-app database backup (backup-daily runs
# `pg_dump`). From the PostgreSQL project's own apt repository: Debian bookworm
# ships pg_dump 15, which refuses to dump a Postgres 17 server.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
         https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
         > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
    && apt-get purge -y curl && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

# The /deploy directory from pnpm deploy is already a standalone package:
#   /app/package.json   ← backend's package.json
#   /app/node_modules/  ← production deps (real copies, not symlinks)
#   /app/dist/          ← tsup bundle (overlaid above)
#   /app/migrate.mjs    ← migration runner (overlaid above)
COPY --from=builder /deploy /app

EXPOSE 3000

CMD ["node", "dist/node.js"]
