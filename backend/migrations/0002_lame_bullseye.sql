CREATE TABLE "document_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documentId" uuid NOT NULL,
	"staffId" uuid NOT NULL,
	"action" text NOT NULL,
	"accessedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staffId" uuid NOT NULL,
	"evaluationPeriod" text NOT NULL,
	"category" text NOT NULL,
	"score" real NOT NULL,
	"notes" text,
	"feedback" text,
	"evaluatedById" text NOT NULL,
	"evaluatedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staffId" uuid NOT NULL,
	"code" text NOT NULL,
	"phone" text NOT NULL,
	"purpose" text DEFAULT 'password_reset' NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"usedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staffId" uuid NOT NULL,
	"requestType" text NOT NULL,
	"subType" text,
	"description" text,
	"reason" text,
	"startDate" timestamp,
	"endDate" timestamp,
	"amount" real,
	"urgencyLevel" text DEFAULT 'normal',
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewedById" text,
	"reviewedAt" timestamp,
	"reviewComments" text,
	"submittedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_training_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staffId" uuid NOT NULL,
	"trainingId" uuid NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"progressPercent" integer DEFAULT 0 NOT NULL,
	"score" real,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"certificateIssued" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"materialType" text NOT NULL,
	"contentUrl" text,
	"externalUrl" text,
	"isMandatory" boolean DEFAULT false NOT NULL,
	"deadline" timestamp,
	"passingScore" real,
	"assignedTo" jsonb DEFAULT '[]'::jsonb,
	"assignedDepartments" jsonb DEFAULT '[]'::jsonb,
	"uploadedById" text NOT NULL,
	"uploadedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_reports" ALTER COLUMN "totalPayments" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "daily_reports" ALTER COLUMN "totalExpenses" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "amount" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "payment_plan_templates" ALTER COLUMN "totalAmount" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "payment_plan_templates" ALTER COLUMN "amountPerInstallment" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "payment_plans" ALTER COLUMN "totalAmount" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "payment_plans" ALTER COLUMN "amountPerInstallment" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "amount" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "balance" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "costPrice" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "unitPrice" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "costPrice" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "totalAmount" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "profit" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "staffId" text DEFAULT 'TEMP-ID' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "userId" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "dateOfJoining" timestamp;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "isExternalTrainer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "profileImage" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "emergencyContactName" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "emergencyContactPhone" text;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD COLUMN "documentType" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_documentId_staff_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."staff_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_staffId_staff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_scores" ADD CONSTRAINT "performance_scores_staffId_staff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_scores" ADD CONSTRAINT "performance_scores_evaluatedById_user_id_fk" FOREIGN KEY ("evaluatedById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_otp_codes" ADD CONSTRAINT "staff_otp_codes_staffId_staff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_requests" ADD CONSTRAINT "staff_requests_staffId_staff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_requests" ADD CONSTRAINT "staff_requests_reviewedById_user_id_fk" FOREIGN KEY ("reviewedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_training_progress" ADD CONSTRAINT "staff_training_progress_staffId_staff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_training_progress" ADD CONSTRAINT "staff_training_progress_trainingId_training_materials_id_fk" FOREIGN KEY ("trainingId") REFERENCES "public"."training_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_materials" ADD CONSTRAINT "training_materials_uploadedById_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;