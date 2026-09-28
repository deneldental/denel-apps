-- 0046_api_keys.sql — API keys for external systems (initially the marketing
-- website posting to /api/website-bookings).
--
-- The plaintext key is shown once at generation; only the SHA-256 hash is
-- stored. `keyPrefix` is the first 6 chars of the plaintext, kept in the
-- clear so admins can recognise keys in the UI without seeing the secret.

CREATE TABLE IF NOT EXISTS api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,
  key_prefix    text NOT NULL,
  key_hash      text NOT NULL,
  scope         text NOT NULL,
  created_by_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at    timestamp NOT NULL DEFAULT now(),
  last_used_at  timestamp,
  revoked_at    timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_unique ON api_keys (key_hash);
CREATE INDEX        IF NOT EXISTS api_keys_scope_idx       ON api_keys (scope);
