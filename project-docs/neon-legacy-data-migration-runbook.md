# Neon legacy data migration runbook

## Status (2026-09-16)

`patients` (3911 rows), `payment_plans` (352), `payments` (2870), `staff` (3),
and `training_materials` (2) are pushed to VPS production and confirmed via
`schema-drift-check.js` (0 drift) + row-count + spot-check. Use
`scripts/neon-legacy-data-migration.sh` (`inspect` / `download` / `verify` /
`push`), not the hand-typed SQL below — it encodes the fixes this run
uncovered:

- **Money units** — this Neon snapshot predates migration `0209_dinero_migration.sql`.
  `payments.amount/balance` and `payment_plans.totalAmount/originalAmount/amountPerInstallment`
  (and `sales.unitPrice/costPrice/totalAmount/profit`, when that table is
  eventually handled) are `real` CEDIS in the old data but `integer` CENTS in
  the current schema. The script scales every one of them `x100` via
  `ROUND(col::numeric * 100)::integer`. Skipping this silently corrupts every
  amount by 100x — see `project-docs/money-unit-audit-and-remediation.md`.
- **Quoted identifiers through an SSH heredoc** — `push` originally shipped the
  `\copy` command as a `psql -c "..."` argument inside an SSH heredoc. The
  double-quoted camelCase column names (`"insuranceProvider"`) survive a
  *local* shell (used by `download`/`verify`, which run directly, not over
  SSH) but not a *remote* one: the heredoc's expanded text gets re-parsed by
  the far-end shell, which consumes the embedded quotes a second time and
  hands Postgres an unquoted (and therefore lowercased-and-404d) identifier.
  Fixed by writing the `\copy` command to a `.sql` file and running
  `psql -f` on the VPS instead — no second shell parse of the SQL text.
- **`staff.department` FK** — added at some point after this runbook's
  hand-written `staff_data.sql` example below was drafted. It FKs to
  `hr_departments.name` (`dental` | `front_desk` | `both`), but the old data
  has free-text noise (`'Dental '`, trailing space, wrong case). The script
  normalizes with `NULLIF(regexp_replace(lower(trim(department)), '\s+', '_', 'g'), '')`
  before load; blank/unmapped values become `NULL` (FK-exempt) rather than
  failing the whole table.

Still open: `sales` (blocked on backfilling `items` from the old
`products`/`inventory` tables first — see the comment block above `TABLES=`
in the script) and `staff_otp_codes` (intentionally skipped).

## Context

The VPS production Postgres (`framada-db-1` at `/opt/framada`) was wiped and needed
repopulating from the legacy Neon database (`neondb` on the old Neon project).
That Neon database turned out to be an **older snapshot** of the app — only 45 tables
of real schema, versus the 229 tables the current codebase expects (confirmed via
`node dist/scripts/schema-drift-check.js` on the VPS).

The correct approach is **not** to force the old 45-table schema onto the VPS. It is:

1. Build the **current, full schema** on the VPS via migrations (empty tables).
2. Transplant only the **data** from the old Neon snapshot into the matching tables.
3. For tables whose columns were renamed/added/removed since that snapshot, the data
   needs a one-time cleanup pass before it can load — that's what this runbook covers.

Do the cleanup on your local PC (real editor, no SSH round-trips for every edit), then
push only the finished, verified SQL up to the VPS.

## Prerequisites

- Podman working locally (already confirmed this session: `podman ps` shows the local
  dev DB container).
- SSH access to the VPS (`ssh root@<vps-host>`).
- The Neon connection details (Neon dashboard → Connection Details) and the VPS
  host plus its Postgres password (`docker-compose.yml`/`.env` at `/opt/framada`),
  provided as environment variables — `NEON_HOST`, `NEON_PASSWORD`, `VPS_HOST`,
  `VPS_DB_PASSWORD` (user/db/container names have defaults). Easiest: copy
  `scripts/neon-legacy-data-migration.env.example` to
  `scripts/neon-legacy-data-migration.env` (gitignored) and fill it in; the
  script sources it, and the manual commands below expect the same variables
  exported in your shell (`set -a; source scripts/neon-legacy-data-migration.env; set +a`).
  Nothing sensitive is written into the script or this runbook.

## Status before starting this runbook

Already done on the VPS (do **not** repeat these):

- `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` — DB wiped clean.
- `docker compose exec backend node migrate.mjs` — full current schema (229 tables)
  rebuilt, empty.
- `docker compose exec backend node dist/scripts/schema-drift-check.js` — confirmed
  0 missing tables/columns (schema is current).
- A full old-schema dump sits at `/tmp/neon_backup.dump` on the VPS (custom format,
  made with a Postgres 17 client — required, since Neon is v17 and the VPS's own
  `pg_dump`/`pg_restore` is v16).
- A full **data-only** restore of that dump was already attempted directly against
  `framadadb` and mostly succeeded — roughly 38 of 45 old tables loaded cleanly.
  Seven tables failed because their columns don't match the current schema (see below).
  Two more (`inventory`, `products`) failed because those tables were retired and no
  longer exist in the current schema at all.

**Tables that already loaded successfully — skip them, don't redo:** everything except
the list in the next section.

## Tables that need manual cleanup

| Table | Problem | Verdict |
|---|---|---|
| `patients` | old cols `isOrtho`, `type` no longer exist | drop those 2 columns |
| `sales` | `productId` renamed to `itemId` | rename column |
| `staff` | old col `role` no longer exists | drop that column |
| `staff_otp_codes` | old col `code` (plaintext) replaced by `codeHash`; can't derive a hash from old plaintext without re-hashing, and OTP codes are single-use/short-lived anyway | **skip entirely — no value in migrating** |
| `training_materials` | old col `assignedDepartments` no longer exists; new required-ish cols `kind`, `allowReassessment` have defaults | drop `assignedDepartments`, let new cols default |
| `payment_plans` | new required column `originalAmount` (NOT NULL, no default) | backfill `originalAmount = totalAmount` |
| `payments` | `allocated_amount`/`unallocated_amount` exist but are wrong (0/0) for old rows, violating `payments_amount_split_check` (`allocated + unallocated = amount`); `status` still has legacy value `'completed'`, which the current `payments_status_check` constraint (`draft`/`posted`/`reversed`) rejects | recompute `allocated_amount = amount`, `unallocated_amount = 0`; remap `status`: `completed`→`posted`, `refunded`→`reversed`, anything else→`draft` |

**Skip these — retired tables, no longer in the current schema at all:**
`inventory`, `products` (superseded by `items` / `inventory_batches` / `inventory_locations`).

## Step 1 — Download each table's data from Neon (run locally)

For the simple column-drop/rename tables (`patients`, `sales`, `staff`,
`training_materials`), pull a human-editable SQL file:

```bash
podman run --rm -e PGPASSWORD="$NEON_PASSWORD" \
  -v "$(pwd):/backup" --entrypoint pg_dump postgres:17-alpine \
  -h "$NEON_HOST" -U "${NEON_USER:-neondb_owner}" -d "${NEON_DB:-neondb}" --sslmode=require \
  --data-only --table=<table_name> --column-inserts \
  -f /backup/<table_name>_data.sql
```

Repeat for `patients`, `sales`, `staff`, `training_materials` (swap `--table=` and the
output filename each time).

For `payments` and `payment_plans`, don't hand-edit hundreds of `VALUES` rows — export
via a **transforming SELECT** instead, so the correct values are computed for you. First
check the real old column list so the SELECT is accurate:

```bash
podman run --rm -e PGPASSWORD="$NEON_PASSWORD" --entrypoint psql postgres:17-alpine \
  -h "$NEON_HOST" -U "${NEON_USER:-neondb_owner}" -d "${NEON_DB:-neondb}" --sslmode=require \
  -c "\d payments" -c "\d payment_plans"
```

Then adjust and run (this is a starting template — confirm every old column name
against the `\d` output above before running):

```bash
podman run --rm -e PGPASSWORD="$NEON_PASSWORD" -v "$(pwd):/backup" --entrypoint psql postgres:17-alpine \
  -h "$NEON_HOST" -U "${NEON_USER:-neondb_owner}" -d "${NEON_DB:-neondb}" --sslmode=require \
  -c "\copy (SELECT id, \"patientId\", \"appointmentId\", \"paymentPlanId\", \"invoiceId\", amount, method, CASE status WHEN 'completed' THEN 'posted' WHEN 'refunded' THEN 'reversed' ELSE 'draft' END AS status, description, \"transactionId\", \"sendNotification\", balance, treatments, \"createdAt\", \"paymentNumber\", direction, \"partyType\", \"partyId\", \"paymentDate\", \"channelAccountId\", amount AS \"allocatedAmount\", 0 AS \"unallocatedAmount\", \"externalReference\" FROM payments) TO '/backup/payments_data.csv' WITH CSV" 

podman run --rm -e PGPASSWORD="$NEON_PASSWORD" -v "$(pwd):/backup" --entrypoint psql postgres:17-alpine \
  -h "$NEON_HOST" -U "${NEON_USER:-neondb_owner}" -d "${NEON_DB:-neondb}" --sslmode=require \
  -c "\copy (SELECT id, \"patientId\", \"invoiceId\", type, \"totalAmount\", \"totalAmount\" AS \"originalAmount\", 0 AS \"discountAmount\", \"amountPerInstallment\", \"paymentFrequency\", \"startDate\", status, notes, treatments, \"createdAt\", \"updatedAt\" FROM payment_plans) TO '/backup/payment_plans_data.csv' WITH CSV"
```

## Step 2 — Clean up the simple tables locally

Open each `<table>_data.sql` file (VS Code or similar) and, for every `INSERT INTO
<table> (col1, col2, ...) VALUES (...)` line:

- **`patients_data.sql`** — remove `"isOrtho"` and `type` from the column list, and
  remove their corresponding values from every `VALUES (...)` tuple (same position).
- **`sales_data.sql`** — change `"productId"` to `"itemId"` in the column list only;
  values are unchanged.
- **`staff_data.sql`** — remove `role` from the column list and its value from every row.
- **`training_materials_data.sql`** — remove `"assignedDepartments"` from the column
  list and its value from every row.

The `payments`/`payment_plans` CSVs from Step 1 already have the correct columns and
values baked in via the `SELECT` — no manual editing needed there, just a sanity read.

## Step 3 — Verify locally before touching production

Your existing local dev DB (`framada-dev-db`, port 5433) already has the *current*
schema (it went through `db:local:setup`). Load each cleaned file against it first:

```bash
psql "postgresql://framada:framada@localhost:5433/framada" -f patients_data.sql
psql "postgresql://framada:framada@localhost:5433/framada" -f sales_data.sql
psql "postgresql://framada:framada@localhost:5433/framada" -f staff_data.sql
psql "postgresql://framada:framada@localhost:5433/framada" -f training_materials_data.sql
psql "postgresql://framada:framada@localhost:5433/framada" -c "\copy payments (id, \"patientId\", \"appointmentId\", \"paymentPlanId\", \"invoiceId\", amount, method, status, description, \"transactionId\", \"sendNotification\", balance, treatments, \"createdAt\", \"paymentNumber\", direction, \"partyType\", \"partyId\", \"paymentDate\", \"channelAccountId\", \"allocatedAmount\", \"unallocatedAmount\", \"externalReference\") FROM 'payments_data.csv' WITH CSV"
psql "postgresql://framada:framada@localhost:5433/framada" -c "\copy payment_plans (id, \"patientId\", \"invoiceId\", type, \"totalAmount\", \"originalAmount\", \"discountAmount\", \"amountPerInstallment\", \"paymentFrequency\", \"startDate\", status, notes, treatments, \"createdAt\", \"updatedAt\") FROM 'payment_plans_data.csv' WITH CSV"
```

`psql` (not `podman run ... psql`) works here directly if you have a local Postgres
client, or wrap each command the same way as Step 1 (`podman run --rm --network host ...`)
if you don't. Fix any errors here — this environment is disposable and safe to break.

If a table already has rows in your local dev DB with colliding primary keys, either
truncate it first (`TRUNCATE patients CASCADE;` — only on this disposable local DB) or
skip verification for that one table.

## Step 4 — Push the verified files to the VPS and apply

```bash
scp patients_data.sql sales_data.sql staff_data.sql training_materials_data.sql \
    payments_data.csv payment_plans_data.csv \
    root@<vps-host>:/tmp/

ssh root@<vps-host>
```

Then, on the VPS:

```bash
docker cp /tmp/patients_data.sql framada-db-1:/tmp/
docker cp /tmp/sales_data.sql framada-db-1:/tmp/
docker cp /tmp/staff_data.sql framada-db-1:/tmp/
docker cp /tmp/training_materials_data.sql framada-db-1:/tmp/
docker cp /tmp/payments_data.csv framada-db-1:/tmp/
docker cp /tmp/payment_plans_data.csv framada-db-1:/tmp/

docker exec -i framada-db-1 psql -U postgres -d framadadb -f /tmp/patients_data.sql
docker exec -i framada-db-1 psql -U postgres -d framadadb -f /tmp/sales_data.sql
docker exec -i framada-db-1 psql -U postgres -d framadadb -f /tmp/staff_data.sql
docker exec -i framada-db-1 psql -U postgres -d framadadb -f /tmp/training_materials_data.sql

docker exec framada-db-1 psql -U postgres -d framadadb -c "\copy payments (id, \"patientId\", \"appointmentId\", \"paymentPlanId\", \"invoiceId\", amount, method, status, description, \"transactionId\", \"sendNotification\", balance, treatments, \"createdAt\", \"paymentNumber\", direction, \"partyType\", \"partyId\", \"paymentDate\", \"channelAccountId\", \"allocatedAmount\", \"unallocatedAmount\", \"externalReference\") FROM '/tmp/payments_data.csv' WITH CSV"
docker exec framada-db-1 psql -U postgres -d framadadb -c "\copy payment_plans (id, \"patientId\", \"invoiceId\", type, \"totalAmount\", \"originalAmount\", \"discountAmount\", \"amountPerInstallment\", \"paymentFrequency\", \"startDate\", status, notes, treatments, \"createdAt\", \"updatedAt\") FROM '/tmp/payment_plans_data.csv' WITH CSV"
```

Apply one table at a time and check for errors after each — don't run them all blind in
one go, given how many surprises this migration has already produced.

## Step 5 — Post-migration verification

```bash
# Schema should still be fully current (this step only inserted data, no DDL)
docker compose exec backend node dist/scripts/schema-drift-check.js

# Spot-check row counts landed
docker exec framada-db-1 psql -U postgres -d framadadb -c \
  "SELECT 'patients', count(*) FROM patients
   UNION ALL SELECT 'payments', count(*) FROM payments
   UNION ALL SELECT 'payment_plans', count(*) FROM payment_plans
   UNION ALL SELECT 'staff', count(*) FROM staff
   UNION ALL SELECT 'sales', count(*) FROM sales
   UNION ALL SELECT 'training_materials', count(*) FROM training_materials;"
```

Then test an actual login at `api.framada.app` with an account you know exists in the
old Neon data, and click around a patient record with payments/a payment plan to
confirm the numbers look right.

## Known leftover items (not part of this runbook)

- `role_permissions` — already correctly seeded by `migrate.mjs`/RBAC sync in Step 0;
  don't re-import old `role_permissions` data, it will just collide on the primary key.
- `__drizzle_migrations` / `__applied_migrations` — infrastructure tables, already
  correctly populated by `migrate.mjs`. Never restore these from the old dump.
- Production RBAC reseed is still outstanding from earlier this session (unrelated to
  this migration): `doppler run --project framada-projects --config prd -- pnpm --filter backend seed:rbac`.
