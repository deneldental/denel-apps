ALTER TABLE "appointment_types" ADD COLUMN "colour" text DEFAULT '#94A3B8' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "dailyReportId" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_dailyReportId_daily_reports_id_fk" FOREIGN KEY ("dailyReportId") REFERENCES "public"."daily_reports"("id") ON DELETE set null ON UPDATE no action;