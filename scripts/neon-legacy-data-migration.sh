#!/usr/bin/env bash
# neon-legacy-data-migration.sh
#
# Transplants data from an older Neon schema snapshot into the current, fully
# migrated VPS production database. See:
#   project-docs/neon-legacy-data-migration-runbook.md
# for the full narrative — this script automates that runbook's steps.
#
# 7 tables need transformation (renamed/added/dropped columns since the Neon
# snapshot was taken); everything else already loaded fine in an earlier full
# restore and is not touched here. Of those 7:
#   - patients, staff, training_materials, payments, payment_plans -> handled
#     by this script (TABLES below). Verified 2026-09-15 against the live
#     Neon schema via `inspect` (previously these were reconstructed from
#     partial error output only).
#   - staff_otp_codes -> intentionally skipped, no value in migrating
#     ephemeral OTP codes.
#   - sales -> NOT handled here yet. Its old `productId` FK'd into `products`,
#     which no longer exists (superseded by `items`, migration 0100/0102).
#     `items` only contains rows for products/inventory that existed AT THE
#     TIME migration 0100 ran; since the VPS schema was rebuilt from an empty
#     DB (see the runbook's "Status before starting"), `items` has none of
#     the old product rows, so `sales.itemId` will fail its FK for every old
#     row until `items` is backfilled from the old `products`/`inventory`
#     tables first (same id-preserving INSERT migration 0100 used). Do that
#     separately before attempting `sales` — pushing it as a straight
#     productId->itemId rename, as the runbook currently describes, WILL fail.
#
# Usage:
#   ./scripts/neon-legacy-data-migration.sh inspect   # print \d for each table from Neon
#   ./scripts/neon-legacy-data-migration.sh download  # export cleaned CSVs locally
#   ./scripts/neon-legacy-data-migration.sh verify    # dry-run load into local dev DB (rolled back)
#   ./scripts/neon-legacy-data-migration.sh push      # scp + apply to the VPS, one table at a time
#
# Connection details and passwords come from the environment — see the CONFIG
# section. Never edit a secret into this file: it is committed.

set -euo pipefail

# Git Bash/MSYS2 auto-rewrites any "/xxx"-looking argument into a Windows path
# before handing it to podman.exe/docker.exe/ssh.exe — even container-internal
# paths like "/backup/foo.csv" that have nothing to do with the Windows
# filesystem. That corrupts every -v mount target and every \copy path in this
# script. Disabling it here is a no-op on real Linux/macOS, so it's safe either way.
export MSYS_NO_PATHCONV=1

# ─── CONFIG — from the environment, never from this file ───────────────────────
# Every host and password is read from environment variables so nothing
# sensitive is committed. Either export them in your shell, or copy
# scripts/neon-legacy-data-migration.env.example to
# scripts/neon-legacy-data-migration.env (gitignored) and fill it in — that
# file is sourced here when it exists (override its path with
# NEON_MIGRATION_ENV_FILE).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${NEON_MIGRATION_ENV_FILE:-$SCRIPT_DIR/neon-legacy-data-migration.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Required per command (checked by require_env before anything runs):
#   inspect / download : NEON_HOST, NEON_PASSWORD
#   push               : VPS_HOST, VPS_DB_PASSWORD
# Optional, with non-secret defaults:
NEON_USER="${NEON_USER:-neondb_owner}"
NEON_DB="${NEON_DB:-neondb}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/id_hetzner_framada}"
VPS_DB_CONTAINER="${VPS_DB_CONTAINER:-framada-db-1}"
VPS_DB_USER="${VPS_DB_USER:-postgres}"
VPS_DB_NAME="${VPS_DB_NAME:-framadadb}"
# The local dev Postgres started by `pnpm --filter backend db:local:up`; its
# password is the documented default (CLAUDE.md), not a secret.
LOCAL_DEV_PASSWORD="${LOCAL_DEV_PASSWORD:-framada}"

# Aborts with one message naming every missing variable, before any network call.
require_env() {
  local missing=()
  local name
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  if (( ${#missing[@]} > 0 )); then
    echo "Missing required environment variable(s): ${missing[*]}" >&2
    echo "Export them, or fill $SCRIPT_DIR/neon-legacy-data-migration.env" >&2
    echo "(copy neon-legacy-data-migration.env.example; the file is gitignored)." >&2
    exit 1
  fi
}

OUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/tmp-neon-migration"
mkdir -p "$OUT_DIR"

# ─── Per-table transforming SELECTs ────────────────────────────────────────────
# IMPORTANT: these old-column-name assumptions are reconstructed from partial
# error output, not verified against the live Neon schema. Run `inspect` first
# and compare against the `\d` output before trusting these for real.

# Order matters for `push`/`verify`: patients before payment_plans/payments
# (both FK patientId -> patients), and payment_plans before payments (payments
# .paymentPlanId -> payment_plans, a non-deferrable FK checked per-row). staff
# and training_materials only depend on the pre-existing `user` table, so their
# position relative to the others doesn't matter.
TABLES=(patients payment_plans payments staff training_materials)

select_sql() {
  case "$1" in
    patients)
      echo 'SELECT id, name, email, phone, dob, gender, address, "insuranceProvider", "insurancePolicyNumber", "emergencyContactName", "emergencyContactPhone", "createdAt", "updatedAt", occupation, "profileImage", "isChild", "guardianName", "guardianPhone", "guardianEmail", "guardianAddress", "guardianOccupation", "patientId", nationality FROM patients'
      ;;
    staff)
      # department now FKs to hr_departments.name ('dental' | 'front_desk' |
      # 'both' — added after this select_sql was first written, caught by a
      # real push attempt: "Key (department)=(Dental ) is not present in
      # table hr_departments"). Old data has free-text noise (stray casing,
      # trailing whitespace), so normalize to the lookup's slug shape;
      # NULLIF blanks it out rather than leaving '' (empty string still
      # fails the FK; NULL is exempt from FK checks).
      echo 'SELECT id, "fullName", "employmentType", "createdAt", "updatedAt", "staffId", "userId", username, email, phone, NULLIF(regexp_replace(lower(trim(department)), '"'"'\s+'"'"', '"'"'_'"'"', '"'"'g'"'"'), '"'"''"'"') AS department, "position", "dateOfJoining", status, "isExternalTrainer", "profileImage", "emergencyContactName", "emergencyContactPhone" FROM staff'
      ;;
    training_materials)
      echo 'SELECT id, title, description, "materialType", "contentUrl", "externalUrl", "isMandatory", deadline, "passingScore", "assignedTo", "uploadedById", "uploadedAt", "createdAt", "updatedAt", blocks, "quizTimer", "quizQuestions", published, audience, level, "publishedAt" FROM training_materials'
      ;;
    payments)
      # Old table has only the base 13 columns (no Phase-3 fields at all).
      # allocatedAmount/unallocatedAmount are computed so payments_amount_split_check
      # (allocated + unallocated = amount) holds; status is remapped the same way
      # migration 0036 originally handled these legacy values (completed->posted,
      # refunded->reversed, else draft).
      #
      # MONEY UNIT: confirmed via `inspect` that this Neon snapshot predates
      # migration 0209_dinero_migration.sql — amount/balance are `real` CEDIS
      # here, but the current schema's amount/balance/allocated_amount/
      # unallocated_amount are `integer` CENTS. Every one of them is scaled
      # x100 below (via ::numeric first, to avoid float32 `real` rounding
      # noise on the raw x100 multiply). Do NOT drop this scaling — see
      # project-docs/money-unit-audit-and-remediation.md for the defect class
      # this would otherwise reproduce.
      echo "SELECT id, \"patientId\", \"appointmentId\", \"paymentPlanId\", ROUND(amount::numeric * 100)::integer AS amount, method, CASE status WHEN 'completed' THEN 'posted' WHEN 'refunded' THEN 'reversed' ELSE 'draft' END AS status, description, \"transactionId\", \"sendNotification\", ROUND(balance::numeric * 100)::integer AS balance, treatments, \"createdAt\", ROUND(amount::numeric * 100)::integer AS allocated_amount, 0 AS unallocated_amount FROM payments"
      ;;
    payment_plans)
      # Old table has no invoiceId. templateId is dropped — payment-plan templates
      # were removed from the current schema entirely this session.
      #
      # MONEY UNIT: same x100 cedis->cents scaling as payments (see note above)
      # for totalAmount/originalAmount/amountPerInstallment. discountAmount is
      # hardcoded 0 either way, so it needs no scaling.
      echo 'SELECT id, "patientId", ROUND("totalAmount"::numeric * 100)::integer AS "totalAmount", ROUND("totalAmount"::numeric * 100)::integer AS "originalAmount", 0 AS "discountAmount", "paymentFrequency", "startDate", status, notes, "createdAt", "updatedAt", ROUND("amountPerInstallment"::numeric * 100)::integer AS "amountPerInstallment", type, treatments FROM payment_plans'
      ;;
    *)
      echo "unknown table: $1" >&2; exit 1 ;;
  esac
}

# Target column list on the CURRENT schema — must match the SELECT's output
# column order/aliases exactly, since \copy binds positionally.
target_columns() {
  case "$1" in
    patients)
      echo 'id, name, email, phone, dob, gender, address, "insuranceProvider", "insurancePolicyNumber", "emergencyContactName", "emergencyContactPhone", "createdAt", "updatedAt", occupation, "profileImage", "isChild", "guardianName", "guardianPhone", "guardianEmail", "guardianAddress", "guardianOccupation", "patientId", nationality'
      ;;
    staff)
      echo 'id, "fullName", "employmentType", "createdAt", "updatedAt", "staffId", "userId", username, email, phone, department, "position", "dateOfJoining", status, "isExternalTrainer", "profileImage", "emergencyContactName", "emergencyContactPhone"'
      ;;
    training_materials)
      echo 'id, title, description, "materialType", "contentUrl", "externalUrl", "isMandatory", deadline, "passingScore", "assignedTo", "uploadedById", "uploadedAt", "createdAt", "updatedAt", blocks, "quizTimer", "quizQuestions", published, audience, level, "publishedAt"'
      ;;
    payments)
      echo 'id, "patientId", "appointmentId", "paymentPlanId", amount, method, status, description, "transactionId", "sendNotification", balance, treatments, "createdAt", allocated_amount, unallocated_amount'
      ;;
    payment_plans)
      echo 'id, "patientId", "totalAmount", "originalAmount", "discountAmount", "paymentFrequency", "startDate", status, notes, "createdAt", "updatedAt", "amountPerInstallment", type, treatments'
      ;;
    *)
      echo "unknown table: $1" >&2; exit 1 ;;
  esac
}

# ─── Commands ───────────────────────────────────────────────────────────────────

cmd_inspect() {
  require_env NEON_HOST NEON_PASSWORD
  for t in "${TABLES[@]}" staff_otp_codes; do
    echo "── $t ──────────────────────────────────────────────"
    podman run --rm -e PGPASSWORD="$NEON_PASSWORD" --entrypoint psql postgres:17-alpine \
      -h "$NEON_HOST" -U "$NEON_USER" -d "$NEON_DB"  \
      -c "\d \"$t\""
    echo
  done
  echo "Compare the columns above against select_sql()/target_columns() in this"
  echo "script before running 'download' or 'push' for real."
}

cmd_download() {
  require_env NEON_HOST NEON_PASSWORD
  for t in "${TABLES[@]}"; do
    echo "Downloading $t ..."
    podman run --rm -e PGPASSWORD="$NEON_PASSWORD" -v "$OUT_DIR:/backup" --entrypoint psql postgres:17-alpine \
      -h "$NEON_HOST" -U "$NEON_USER" -d "$NEON_DB" \
      -c "\copy ($(select_sql "$t")) TO '/backup/${t}.csv' WITH CSV"
    lines=$(wc -l < "$OUT_DIR/${t}.csv" | tr -d ' ')
    echo "  -> $OUT_DIR/${t}.csv ($lines rows)"
  done
  echo "Done. Review the CSVs in $OUT_DIR before verifying/pushing."
}

verify_group() {
  # A Postgres transaction aborts entirely on its first error — every later
  # statement in the same transaction just reports "current transaction is
  # aborted" and tells you nothing new. So each independent dependency group
  # gets run in its own transaction; one group's expected failure never masks
  # another group's real signal.
  local group_name="$1"; shift
  echo "── $group_name ──────────────────────────────────────────"
  {
    echo "BEGIN;"
    for t in "$@"; do
      [[ -f "$OUT_DIR/${t}.csv" ]] || continue
      echo "\\echo -- loading $t --"
      echo "\\copy $t ($(target_columns "$t")) FROM '/backup/${t}.csv' WITH CSV"
    done
    echo "ROLLBACK;"
  } | podman run --rm -i --network backend_default -v "$OUT_DIR:/backup" \
      -e PGPASSWORD="$LOCAL_DEV_PASSWORD" --entrypoint psql postgres:17-alpine \
      -h framada-dev-db -U framada -d framada
}

cmd_verify() {
  # Group 1: the tables that actually matter here, in dependency order
  # (patients before anything referencing patientId) inside ONE transaction —
  # so payment_plans/payments can see the patients rows the same way the real
  # sequential push to the VPS will behave. A failure anywhere in this group
  # is a real problem.
  verify_group "patients / payment_plans / payments" patients payment_plans payments

  # Group 2 and 3, each on their own: staff/training_materials reference
  # "user" (Better Auth accounts), which this migration does not touch — that
  # table was already restored in the earlier full data-only restore pass,
  # before this per-table cleanup started. Your LOCAL dev DB's "user" table is
  # a fresh seed (just the default admin), not a copy of the old Neon users,
  # so both of these are EXPECTED to fail here with a userId FK error — that's
  # not something this dry-run can validate. Confirm those user ids exist on
  # the VPS directly instead (see the runbook) before trusting these two.
  verify_group "staff (expect a userId FK error locally — see note above)" staff
  verify_group "training_materials (expect a uploadedById FK error locally — see note above)" training_materials

  echo
  echo "Review each group above. The first group failing is a real problem to fix;"
  echo "the other two failing on their user-table FK is expected locally."
}

cmd_push() {
  require_env VPS_HOST VPS_DB_PASSWORD
  local tables=("$@")
  [[ ${#tables[@]} -eq 0 ]] && tables=("${TABLES[@]}")

  # The \copy command is written to a .sql FILE, not passed as a `psql -c`
  # command-line argument. Quoted camelCase column identifiers (e.g.
  # "insuranceProvider") contain literal double-quote characters; piping them
  # through an SSH heredoc means the REMOTE shell re-parses that text as shell
  # syntax a second time, and its quotes get consumed/stripped in the process
  # (Postgres then folds the now-unquoted identifier to lowercase and 404s on
  # it — this is exactly what happened the first time this ran: "column
  # insuranceprovider does not exist"). A file handed to `psql -f` sidesteps
  # shell re-parsing entirely — psql reads the identifiers byte-for-byte.
  for t in "${tables[@]}"; do
    echo "\\copy $t ($(target_columns "$t")) FROM '/tmp/${t}.csv' WITH CSV" > "$OUT_DIR/${t}.sql"
  done

  echo "Copying CSVs + copy-scripts to $VPS_HOST:/tmp/ ..."
  for t in "${tables[@]}"; do
    scp -i "$VPS_SSH_KEY" "$OUT_DIR/${t}.csv" "$OUT_DIR/${t}.sql" "$VPS_HOST:/tmp/"
  done

  for t in "${tables[@]}"; do
    echo "Applying $t on the VPS ..."
    ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "
      set -e
      docker cp /tmp/${t}.csv $VPS_DB_CONTAINER:/tmp/${t}.csv
      docker cp /tmp/${t}.sql $VPS_DB_CONTAINER:/tmp/${t}.sql
      docker exec -e PGPASSWORD='$VPS_DB_PASSWORD' $VPS_DB_CONTAINER \
        psql -U $VPS_DB_USER -d $VPS_DB_NAME -f /tmp/${t}.sql
    "
    echo "  -> $t applied. Check the output above for errors before continuing."
    # NOTE: no interactive confirm here (this script runs unattended from
    # non-interactive contexts, where a `read` prompt on missing stdin would
    # just silently auto-continue rather than actually pause) — the caller is
    # responsible for reviewing each table's output before/while this runs.
  done

  echo "All tables pushed. Now run the post-migration checks from the runbook:"
  echo "  ssh -i \"$VPS_SSH_KEY\" $VPS_HOST 'docker compose exec backend node dist/scripts/schema-drift-check.js'"
}

case "${1:-}" in
  inspect)  cmd_inspect ;;
  download) cmd_download ;;
  verify)   cmd_verify ;;
  push)     shift; cmd_push "$@" ;;
  *)
    echo "Usage: $0 {inspect|download|verify|push}" >&2
    exit 1
    ;;
esac
