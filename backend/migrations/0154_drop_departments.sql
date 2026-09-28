-- Remove the "departments" concept entirely. The clinic never populated
-- departments, so this is behaviourally safe — it drops dead surface area:
--   • staff.department free-text column (added in 0002)
--   • hr_departments CRUD lookup table + its index (added in 0060)
--   • training_materials.assignedDepartments jsonb column (camelCase column)
-- All backend/frontend references were removed in the same change. Idempotent.
ALTER TABLE "staff" DROP COLUMN IF EXISTS "department";--> statement-breakpoint
ALTER TABLE "training_materials" DROP COLUMN IF EXISTS "assignedDepartments";--> statement-breakpoint
DROP INDEX IF EXISTS "hr_departments_active_idx";--> statement-breakpoint
DROP TABLE IF EXISTS "hr_departments";
