-- Central SMS templates: add a stable `key` so system events (e.g. lab status
-- changes) can resolve a template by key from the one editable-in-one-place
-- store (CRM → SMS Templates). Then seed the lab per-status templates as keyed
-- entries. The lab notify reads from here, so a single edit applies everywhere.
ALTER TABLE "reminder_templates" ADD COLUMN IF NOT EXISTS "key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_templates_key_uidx" ON "reminder_templates" ("key") WHERE "key" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Lab — Dispatched', 'Hi {firstName}, your {service} has been sent to our dental lab. We will keep you updated as it progresses. - Framada Dental', 'lab_status:sent'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'lab_status:sent');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Lab — In Progress', 'Hi {firstName}, your {service} is now being made at the lab. - Framada Dental', 'lab_status:in_progress'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'lab_status:in_progress');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Lab — Shipped', 'Hi {firstName}, your {service} is on its way back to the clinic. - Framada Dental', 'lab_status:received'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'lab_status:received');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Lab — Ready', 'Hi {firstName}, your {service} is ready. Please contact us to book your fitting appointment. - Framada Dental', 'lab_status:ready_for_insertion'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'lab_status:ready_for_insertion');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Lab — Delayed', 'Hi {firstName}, there is a short delay on your {service}. New expected date: {expectedDate}. Apologies for the inconvenience. - Framada Dental', 'lab_status:delayed'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'lab_status:delayed');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Lab — Cancelled', 'Hi {firstName}, your {service} lab order has been cancelled. Please contact us if you have any questions. - Framada Dental', 'lab_status:cancelled'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'lab_status:cancelled');
