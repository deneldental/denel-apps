-- admin-v1 §6.3 — link treatment-plan items to the services catalog so name + cost
-- are catalog-sourced (the catalog is the single source of truth).
ALTER TABLE "treatment_plan_items" ADD COLUMN IF NOT EXISTS "serviceId" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_serviceId_fk"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
