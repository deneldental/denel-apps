-- Drop `services.pricingMode` — a write-only column.
--
-- Written by the portal (service-pricing-matrix.tsx) and by
-- `routes/services.ts` (POST insert + PATCH allowlist), but never read: the
-- real price resolver, `lib/service-pricing.ts` (`resolveServicePrice`), keys
-- off `service_prices` cells and `application_scopes` directly and never
-- consults this column. Nothing else in backend/, portals/, team/, hr/ or
-- patient/ reads it either.
--
-- It had also drifted three ways:
--   * the schema comment documented 'flat' | 'per_unit' | 'variant' | 'class' |
--     'variant_class';
--   * the portal's derivation could emit 'range', which was not in that set;
--   * live data contains a 'class' row the portal derivation cannot produce.
--
-- Added by 0167_services_matrix. The value is derivable at any time from
-- `scopeId` + the presence/shape of `service_prices` cells, so no data is lost
-- that could not be recomputed.

ALTER TABLE "services" DROP COLUMN IF EXISTS "pricingMode";
