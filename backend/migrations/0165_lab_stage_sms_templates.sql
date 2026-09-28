-- Phase 2 revision (lab): per-status patient SMS templates + relabel the
-- workflow to the clinic's terms. Status KEYS stay fixed (billing, reminders and
-- auto-timestamps depend on them) — only the display labels, order, config and
-- templates change. The per-stage note/photo requirement is dropped: the only
-- input-gated stage is Delayed, which captures a new date + reason directly.
ALTER TABLE "lab_case_statuses" ADD COLUMN IF NOT EXISTS "smsTemplate" text;
--> statement-breakpoint
ALTER TABLE "lab_case_statuses" DROP COLUMN IF EXISTS "requiresNote";
--> statement-breakpoint
ALTER TABLE "lab_case_statuses" DROP COLUMN IF EXISTS "requiresPhoto";
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "displayName" = 'Ordered',     "sortOrder" = 10 WHERE "name" = 'draft';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "displayName" = 'Dispatched',  "sortOrder" = 20 WHERE "name" = 'sent';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "displayName" = 'In Progress', "sortOrder" = 30 WHERE "name" = 'in_progress';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "displayName" = 'Shipped',     "sortOrder" = 40 WHERE "name" = 'received';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "displayName" = 'Ready',       "sortOrder" = 50 WHERE "name" = 'ready_for_insertion';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "displayName" = 'Delayed',     "sortOrder" = 60 WHERE "name" = 'delayed';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "displayName" = 'Cancelled',   "sortOrder" = 70 WHERE "name" = 'cancelled';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "displayName" = 'Inserted',    "sortOrder" = 80 WHERE "name" = 'inserted';
--> statement-breakpoint
-- Default per-status patient SMS templates. 'draft' (Ordered) has none: creating
-- the order does not notify the patient. Tokens: {firstName} {service} {expectedDate}.
UPDATE "lab_case_statuses" SET "smsTemplate" = 'Hi {firstName}, your {service} has been sent to our dental lab. We will keep you updated as it progresses. - Framada Dental' WHERE "name" = 'sent';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "smsTemplate" = 'Hi {firstName}, your {service} is now being made at the lab. - Framada Dental' WHERE "name" = 'in_progress';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "smsTemplate" = 'Hi {firstName}, your {service} is on its way back to the clinic. - Framada Dental' WHERE "name" = 'received';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "smsTemplate" = 'Hi {firstName}, your {service} is ready. Please contact us to book your fitting appointment. - Framada Dental' WHERE "name" = 'ready_for_insertion';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "smsTemplate" = 'Hi {firstName}, there is a short delay on your {service}. New expected date: {expectedDate}. Apologies for the inconvenience. - Framada Dental' WHERE "name" = 'delayed';
--> statement-breakpoint
UPDATE "lab_case_statuses" SET "smsTemplate" = 'Hi {firstName}, your {service} lab order has been cancelled. Please contact us if you have any questions. - Framada Dental' WHERE "name" = 'cancelled';
