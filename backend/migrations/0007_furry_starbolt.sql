CREATE TABLE "bundle_permissions" (
	"bundleId" text NOT NULL,
	"permissionId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documentName" text NOT NULL,
	"category" text NOT NULL,
	"documentUrl" text,
	"dateIssued" timestamp,
	"dateExpired" timestamp,
	"reminderEnabled" boolean DEFAULT false NOT NULL,
	"reminderMonthsBefore" integer DEFAULT 3,
	"reminderPhones" jsonb DEFAULT '[]'::jsonb,
	"reminderMessage" text,
	"createdById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"displayName" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patient_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "permission_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope" text DEFAULT 'portal' NOT NULL,
	"isSystem" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "permission_bundles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "role_bundles" (
	"roleId" text NOT NULL,
	"bundleId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_scopes" (
	"roleId" text NOT NULL,
	"scope" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_scopes" (
	"userId" text NOT NULL,
	"scope" text NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"reason" text,
	"grantedById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "nationality" SET DEFAULT 'Ghanaian';--> statement-breakpoint
ALTER TABLE "training_materials" ALTER COLUMN "materialType" SET DEFAULT 'module';--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "howDidYouHear" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "howDidYouHearOther" text;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "isSystem" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "updatedAt" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "training_materials" ADD COLUMN "quizTimer" integer;--> statement-breakpoint
ALTER TABLE "training_materials" ADD COLUMN "quizQuestions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "training_materials" ADD COLUMN "blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "training_materials" ADD COLUMN "audience" text DEFAULT 'All Staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "training_materials" ADD COLUMN "level" text DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "training_materials" ADD COLUMN "published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "training_materials" ADD COLUMN "publishedAt" timestamp;--> statement-breakpoint
ALTER TABLE "bundle_permissions" ADD CONSTRAINT "bundle_permissions_bundleId_permission_bundles_id_fk" FOREIGN KEY ("bundleId") REFERENCES "public"."permission_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_permissions" ADD CONSTRAINT "bundle_permissions_permissionId_permissions_id_fk" FOREIGN KEY ("permissionId") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bundles" ADD CONSTRAINT "role_bundles_roleId_roles_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bundles" ADD CONSTRAINT "role_bundles_bundleId_permission_bundles_id_fk" FOREIGN KEY ("bundleId") REFERENCES "public"."permission_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_scopes" ADD CONSTRAINT "role_scopes_roleId_roles_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_grantedById_user_id_fk" FOREIGN KEY ("grantedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;