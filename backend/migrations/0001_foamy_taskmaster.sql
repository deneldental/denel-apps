ALTER TABLE "products" ADD COLUMN "isLocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "dailyReportId" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_dailyReportId_daily_reports_id_fk" FOREIGN KEY ("dailyReportId") REFERENCES "public"."daily_reports"("id") ON DELETE set null ON UPDATE no action;