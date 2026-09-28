import { defineConfig } from 'tsup'

export default defineConfig({
  // `schema-drift-check` is a second entry so the production image can run the
  // drift sweep with plain `node dist/scripts/schema-drift-check.js`. The image
  // ships `dist/` only — no `src/`, no `tsx` — so without this the check simply
  // cannot execute against production (D3).
  //
  // `money-unit-check` is bundled for the same reason and matters most of all:
  // it is what you run against PRODUCTION to confirm the money columns are still
  // cedis BEFORE 0209 converts them, and pesewas afterwards. A unit check you
  // cannot run in the environment you are about to convert is no check at all.
  //
  // `seed-rbac` and `seed-admin` are bundled for the same reason: the Hetzner
  // deploy runs them via `node dist/scripts/<name>.js` after migrations, so the
  // production DB always has current roles/permissions and a reachable seeded
  // admin. Both are idempotent.
  //
  // `payment-method-audit` is bundled so the unmapped-payment-method exposure
  // (receipts on admin-created slugs silently posting to Cash on Hand) can be
  // measured against PRODUCTION, which ships `dist/` only:
  //   docker compose run --rm backend node dist/scripts/payment-method-audit.js
  // It is READ ONLY.
  //
  // `audit-staff-phones` is bundled for exactly the same reason: it is the
  // readiness check for phone+OTP login (every active staffer needs a unique,
  // normalized phone before the uniqueness constraint can be applied), and the
  // only data that matters is PRODUCTION's. Unbundled it could run against dev
  // only, which proves nothing. It is READ ONLY:
  //   docker compose run --rm backend node dist/scripts/audit-staff-phones.js
  entry: [
    'src/node.ts',
    'src/scripts/schema-drift-check.ts',
    'src/scripts/money-unit-check.ts',
    'src/scripts/money-cutover-check.ts',
    'src/scripts/seed-rbac.ts',
    'src/scripts/seed-admin.ts',
    'src/scripts/payment-method-audit.ts',
    'src/scripts/audit-staff-phones.ts',
  ],
  format: ['cjs'],
  outDir: 'dist',
  clean: true,
  noExternal: ['@denel/utils', '@denel/rbac', '@denel/types'],
})
