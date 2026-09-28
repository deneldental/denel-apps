-- Lab base services join the Services change-request workflow.
--
-- Creating a lab base service becomes admin-only; doctors and receptionists
-- instead propose edits to existing ones, exactly as they already do for regular
-- services. Rather than stand up a parallel table + approval screen, the
-- existing `service_change_requests` gains a second, mutually exclusive target
-- so admins review both kinds of proposal in one place.
--
-- `serviceId` drops NOT NULL so a row can point at a lab base service instead;
-- the CHECK keeps exactly one target set, so a request can never be ambiguous
-- or target nothing at all.

ALTER TABLE "service_change_requests"
  ALTER COLUMN "serviceId" DROP NOT NULL;

ALTER TABLE "service_change_requests"
  ADD COLUMN IF NOT EXISTS "labBaseServiceId" uuid
  REFERENCES "lab_base_services"("id") ON DELETE CASCADE;

ALTER TABLE "service_change_requests"
  DROP CONSTRAINT IF EXISTS "service_change_requests_target_chk";

ALTER TABLE "service_change_requests"
  ADD CONSTRAINT "service_change_requests_target_chk"
  CHECK (num_nonnulls("serviceId", "labBaseServiceId") = 1);

CREATE INDEX IF NOT EXISTS "service_change_requests_lab_base_service_idx"
  ON "service_change_requests" ("labBaseServiceId");
