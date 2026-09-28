CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resendId" text,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"content" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"patientId" uuid,
	"from" text DEFAULT 'Framada Dental <clinic@framada.app>' NOT NULL,
	"sentById" text,
	"sentAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoiceNumber" text NOT NULL,
	"patientId" uuid NOT NULL,
	"planId" uuid,
	"type" text NOT NULL,
	"installmentNumber" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" real NOT NULL,
	"paidAmount" real DEFAULT 0 NOT NULL,
	"dueDate" timestamp,
	"description" text,
	"treatments" jsonb DEFAULT '[]'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoiceNumber_unique" UNIQUE("invoiceNumber")
);
--> statement-breakpoint
CREATE TABLE "patient_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"tokenHash" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"userAgent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patient_sessions_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "patient_timeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"eventType" text NOT NULL,
	"referenceType" text,
	"referenceId" uuid,
	"title" text NOT NULL,
	"description" text,
	"amount" real,
	"createdById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"creditBalance" real DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patient_wallets_patientId_unique" UNIQUE("patientId")
);
--> statement-breakpoint
CREATE TABLE "scheduled_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"triggerType" text NOT NULL,
	"triggerOffsetHours" integer,
	"scheduledAt" timestamp,
	"cronExpression" text,
	"messageTemplate" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"lastRunAt" timestamp,
	"createdById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"walletId" uuid NOT NULL,
	"patientId" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" real NOT NULL,
	"sourceType" text NOT NULL,
	"sourceId" uuid,
	"description" text NOT NULL,
	"balanceBefore" real NOT NULL,
	"balanceAfter" real NOT NULL,
	"createdById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text NOT NULL,
	"preferredDate" text,
	"preferredTime" text,
	"service" text,
	"message" text,
	"status" text DEFAULT 'new' NOT NULL,
	"staffNotes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_plans" DROP CONSTRAINT IF EXISTS "payment_plans_patientId_unique";--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "category" text DEFAULT 'ongoing' NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "pwaAccessEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "pwaPasswordHash" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "pwaAccessGrantedAt" timestamp;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "pwaAccessGrantedById" text;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD COLUMN "originalAmount" real NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD COLUMN "discountAmount" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD COLUMN "numberOfInstallments" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "invoiceId" uuid;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_sentById_user_id_fk" FOREIGN KEY ("sentById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_planId_payment_plans_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."payment_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_sessions" ADD CONSTRAINT "patient_sessions_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_timeline" ADD CONSTRAINT "patient_timeline_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_timeline" ADD CONSTRAINT "patient_timeline_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_wallets" ADD CONSTRAINT "patient_wallets_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reminders" ADD CONSTRAINT "scheduled_reminders_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_patient_wallets_id_fk" FOREIGN KEY ("walletId") REFERENCES "public"."patient_wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_pwaAccessGrantedById_user_id_fk" FOREIGN KEY ("pwaAccessGrantedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;