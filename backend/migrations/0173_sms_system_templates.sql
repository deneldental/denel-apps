-- Register every remaining system SMS into the central store (reminder_templates)
-- so all patient-facing + internal-staff messages are editable in one place
-- (CRM → SMS Templates). Seeds carry the exact current text, so behaviour is
-- unchanged until an admin edits a template. OTP messages are intentionally NOT
-- registered (security: they must carry the code + stay deliverable). Idempotent
-- per the migrate.mjs contract — keyed inserts are skipped if the key exists.

-- ── Patient-facing ───────────────────────────────────────────────────────────
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Patient — Welcome', 'Welcome to {ClinicName}, {Patientname}! Your Patient ID is {PatientID}. We look forward to providing you with excellent dental care. Thank you!', 'patient:welcome'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'patient:welcome');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Appointment — Scheduled/Updated', 'Dear {Patientname}, your appointment has been scheduled for {date} at {time}. Please arrive 30 minutes before time', 'appointment:scheduled'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'appointment:scheduled');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Appointment — Confirmation link', 'Hi {name}, reminder: appointment at {ClinicName} on {date} at {time} with {doctor}. Confirm or cancel: {url}', 'appointment:confirm_link'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'appointment:confirm_link');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Payment — Confirmation', 'Dear {Patientname}, thank you for your payment of GHS {amount} for {treatmenttypes}. Thank you!', 'payment:confirmation'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'payment:confirmation');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Payment — With balance', 'Dear {Patientname}, thank you for your payment of GHS {amount} for {treatmenttypes}. Your current balance is GHS {balance}. Thank you!', 'payment:with_balance'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'payment:with_balance');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Payment Plan — Created', 'Dear {Patientname}, a payment plan of GHS {total} has been set up for your treatment ({treatmenttypes}). Payable in {installments} installments of GHS {perInstallment}. Thank you for choosing {ClinicName}.', 'payment_plan:created'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'payment_plan:created');
--> statement-breakpoint
-- ── Internal staff notifications ─────────────────────────────────────────────
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Memo — New (staff)', 'New memo: {title}. Open the app to read.', 'memo:new'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'memo:new');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Memo — Reminder (staff)', 'Reminder: {title}. Open the app to read.', 'memo:reminder'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'memo:reminder');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Task — Assigned (staff)', 'New task: {title}{due}. Open the app to view.', 'task:new'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'task:new');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Task — Reminder (staff)', 'Reminder: {title}{due}. Open the app to view.', 'task:reminder'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'task:reminder');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Lateness — 1st warning (staff)', 'Lateness warning (1st): you were late {lateCount} times the week of {weekLabel}. This is your first warning — please improve your punctuality.', 'lateness:query_1'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'lateness:query_1');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Lateness — 2nd query (staff)', 'Lateness query (2nd): you were late {lateCount} times the week of {weekLabel}. A written warning will be issued by HR. Continued lateness leads to a meeting with management.', 'lateness:query_2'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'lateness:query_2');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Lateness — Final query (staff)', 'Lateness query (final): you were late {lateCount} times the week of {weekLabel}. You are required to attend a meeting with management.', 'lateness:query_final'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'lateness:query_final');
--> statement-breakpoint
INSERT INTO "reminder_templates" ("name", "messageTemplate", "key")
SELECT 'Compliance — Renewal reminder', 'Renewal reminder: "{documentName}" expires {expiry} ({daysLabel}). Please arrange renewal.', 'compliance:renewal'
WHERE NOT EXISTS (SELECT 1 FROM "reminder_templates" WHERE "key" = 'compliance:renewal');
