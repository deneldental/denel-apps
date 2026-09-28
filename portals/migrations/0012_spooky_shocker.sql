CREATE TABLE "appointment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"displayName" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"entityId" text,
	"entityName" text,
	"changes" jsonb,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reportDate" timestamp NOT NULL,
	"checkedInCount" integer NOT NULL,
	"newPatientsCount" integer NOT NULL,
	"totalPayments" integer NOT NULL,
	"totalExpenses" integer NOT NULL,
	"balances" jsonb NOT NULL,
	"inventoryUsed" jsonb DEFAULT '[]' NOT NULL,
	"productsSold" jsonb DEFAULT '[]' NOT NULL,
	"additionalNote" text,
	"submittedById" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_unavailability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctorId" uuid NOT NULL,
	"startTime" timestamp NOT NULL,
	"endTime" timestamp NOT NULL,
	"reason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"displayName" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"category" text,
	"unit" text,
	"stockQuantity" integer DEFAULT 0 NOT NULL,
	"reorderLevel" integer DEFAULT 10,
	"image" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "ortho_consent_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"consentFormUrl" text,
	"status" text DEFAULT 'unsigned' NOT NULL,
	"uploadedById" text,
	"uploadedAt" timestamp,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ortho_consent_forms_patientId_unique" UNIQUE("patientId")
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"displayName" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "payment_plan_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"totalAmount" integer NOT NULL,
	"amountPerInstallment" integer NOT NULL,
	"paymentFrequency" text NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"templateId" uuid,
	"type" text DEFAULT 'fixed' NOT NULL,
	"totalAmount" integer NOT NULL,
	"amountPerInstallment" integer,
	"paymentFrequency" text,
	"startDate" timestamp NOT NULL,
	"status" text DEFAULT 'activated' NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_plans_patientId_unique" UNIQUE("patientId")
);
--> statement-breakpoint
CREATE TABLE "pending_medical_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"doctorId" uuid NOT NULL,
	"appointmentId" uuid,
	"checkedInAt" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"productId" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unitPrice" integer NOT NULL,
	"costPrice" integer NOT NULL,
	"totalAmount" integer NOT NULL,
	"profit" integer NOT NULL,
	"saleDate" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messageId" text,
	"batchId" text,
	"recipient" text NOT NULL,
	"content" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"patientId" uuid,
	"from" text DEFAULT 'Framada' NOT NULL,
	"sentById" text,
	"sentAt" timestamp DEFAULT now() NOT NULL,
	"deliveredAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fullName" text NOT NULL,
	"role" text NOT NULL,
	"employmentType" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staffId" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"fileUrl" text NOT NULL,
	"uploadedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entityType" text NOT NULL,
	"entityId" uuid NOT NULL,
	"syncMode" text NOT NULL,
	"destination" text,
	"success" boolean NOT NULL,
	"errorMessage" text,
	"syncedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"displayName" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"autoSyncEnabled" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"displayName" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "units_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_recordedBy_user_id_fk";
--> statement-breakpoint
ALTER TABLE "medical_records" DROP CONSTRAINT "medical_records_appointmentId_appointments_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_patientId_patients_id_fk";
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "date" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "medical_records" ALTER COLUMN "diagnosis" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "method" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "paidTo" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "paymentMethod" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "attachmentUrl" text;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "createdById" text;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "complaint" text;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "examination" text;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "treatment" text;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "attachments" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "occupation" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "profileImage" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "patientId" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "type" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "isChild" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "isOrtho" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardianName" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardianPhone" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardianEmail" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardianAddress" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardianOccupation" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "nationality" text DEFAULT 'Ghana';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "paymentPlanId" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "transactionId" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "sendNotification" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "balance" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "costPrice" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stockQuantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "quantityPerPack" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reorderLevel" integer DEFAULT 10;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonatedBy" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banReason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banExpires" timestamp;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_submittedById_user_id_fk" FOREIGN KEY ("submittedById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_unavailability" ADD CONSTRAINT "doctor_unavailability_doctorId_doctors_id_fk" FOREIGN KEY ("doctorId") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ortho_consent_forms" ADD CONSTRAINT "ortho_consent_forms_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ortho_consent_forms" ADD CONSTRAINT "ortho_consent_forms_uploadedById_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_templateId_payment_plan_templates_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."payment_plan_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_medical_records" ADD CONSTRAINT "pending_medical_records_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_medical_records" ADD CONSTRAINT "pending_medical_records_doctorId_doctors_id_fk" FOREIGN KEY ("doctorId") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_medical_records" ADD CONSTRAINT "pending_medical_records_appointmentId_appointments_id_fk" FOREIGN KEY ("appointmentId") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_productId_products_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_sentById_user_id_fk" FOREIGN KEY ("sentById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_staffId_staff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_paymentPlanId_payment_plans_id_fk" FOREIGN KEY ("paymentPlanId") REFERENCES "public"."payment_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN "recordedBy";--> statement-breakpoint
ALTER TABLE "medical_records" DROP COLUMN "appointmentId";--> statement-breakpoint
ALTER TABLE "medical_records" DROP COLUMN "treatmentPlan";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "isRead";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "date";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "notes";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "quantity";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "unitPrice";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "supplier";--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_patientId_unique" UNIQUE("patientId");--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_module_action_unique" UNIQUE("module","action");