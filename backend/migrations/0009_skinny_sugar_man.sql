CREATE TABLE "clinic_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updatedById" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_form_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"content" text NOT NULL,
	"requiresSignature" boolean DEFAULT true NOT NULL,
	"requiresWitness" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "consent_form_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "insurance_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contactEmail" text,
	"contactPhone" text,
	"address" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"activePricingDocId" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_pricing_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companyId" uuid NOT NULL,
	"fileName" text NOT NULL,
	"fileUrl" text NOT NULL,
	"fileSize" integer,
	"mimeType" text,
	"isCurrent" boolean DEFAULT false NOT NULL,
	"version" text,
	"effectiveFrom" timestamp,
	"notes" text,
	"uploadedById" text,
	"uploadedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_reconciliation_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companyId" uuid NOT NULL,
	"patientId" uuid NOT NULL,
	"cardNumber" text NOT NULL,
	"treatmentSourceType" text NOT NULL,
	"treatmentSourceId" uuid NOT NULL,
	"chargedAmount" real NOT NULL,
	"insurerPaidAmount" real,
	"reconciledAt" timestamp,
	"notes" text,
	"walletTransactionId" uuid,
	"recordedById" text,
	"recordedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_case_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"labCaseId" uuid NOT NULL,
	"photoUrl" text NOT NULL,
	"photoType" text NOT NULL,
	"notes" text,
	"uploadedById" text,
	"uploadedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caseNumber" text NOT NULL,
	"patientId" uuid NOT NULL,
	"vendorId" uuid NOT NULL,
	"serviceId" uuid,
	"serviceName" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"toothNumbers" jsonb DEFAULT '[]'::jsonb,
	"shade" text,
	"impressionType" text,
	"sentAt" timestamp,
	"expectedReturn" timestamp,
	"receivedAt" timestamp,
	"insertedAt" timestamp,
	"cost" real DEFAULT 0,
	"assignedTechnicianId" uuid,
	"externalExpenseId" uuid,
	"createdById" text,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lab_cases_caseNumber_unique" UNIQUE("caseNumber")
);
--> statement-breakpoint
CREATE TABLE "lab_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendorId" uuid NOT NULL,
	"serviceName" text NOT NULL,
	"category" text NOT NULL,
	"defaultTurnaroundDays" integer DEFAULT 7,
	"defaultCost" real DEFAULT 0,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"contactEmail" text,
	"contactPhone" text,
	"address" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"category" text NOT NULL,
	"clinicalScope" boolean DEFAULT false NOT NULL,
	"fileName" text NOT NULL,
	"fileUrl" text NOT NULL,
	"fileSize" integer,
	"mimeType" text,
	"notes" text,
	"uploadedById" text,
	"uploadedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_odontogram" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"toothNumber" integer NOT NULL,
	"surface" text NOT NULL,
	"condition" text NOT NULL,
	"notes" text,
	"recordedById" text,
	"recordedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_perio_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"examId" uuid NOT NULL,
	"toothNumber" integer NOT NULL,
	"site" text NOT NULL,
	"pocketDepth" integer NOT NULL,
	"recordedById" text,
	"recordedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"category" text NOT NULL,
	"clinicalScope" boolean DEFAULT true NOT NULL,
	"imageUrl" text NOT NULL,
	"thumbnailUrl" text,
	"capturedAt" timestamp,
	"linkedRecordId" uuid,
	"notes" text,
	"uploadedById" text,
	"uploadedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"reminderDate" timestamp NOT NULL,
	"assignedToId" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"completedAt" timestamp,
	"completedById" text,
	"completionNotes" text,
	"createdById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"sourceTreatmentId" uuid,
	"sourceTreatmentTypeId" uuid,
	"recallReason" text,
	"recallDueDate" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completedAppointmentId" uuid,
	"dismissedAt" timestamp,
	"dismissedById" text,
	"dismissReason" text,
	"notes" text,
	"contactedAt" timestamp,
	"contactedById" text,
	"contactNotes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signed_consent_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"templateId" uuid NOT NULL,
	"patientId" uuid NOT NULL,
	"signatureData" text NOT NULL,
	"signedByName" text NOT NULL,
	"relationshipToPatient" text DEFAULT 'self' NOT NULL,
	"witnessName" text,
	"witnessSignatureData" text,
	"contentSnapshot" text NOT NULL,
	"signedAt" timestamp DEFAULT now() NOT NULL,
	"collectedById" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "staff_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staffId" uuid NOT NULL,
	"credentialType" text NOT NULL,
	"credentialName" text NOT NULL,
	"issuingBody" text,
	"issueDate" timestamp,
	"expiryDate" timestamp,
	"documentUrl" text,
	"notes" text,
	"reminderDaysBefore" integer,
	"reminderEnabled" boolean DEFAULT true NOT NULL,
	"createdById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contactEmail" text,
	"contactPhone" text,
	"address" text,
	"paymentTerms" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sourceType" text,
	"sourceId" uuid,
	"patientId" uuid,
	"baseAmount" real NOT NULL,
	"applyVAT" boolean DEFAULT true NOT NULL,
	"applyNHIL" boolean DEFAULT true NOT NULL,
	"applyGETFund" boolean DEFAULT true NOT NULL,
	"nhilAmount" real NOT NULL,
	"getfundAmount" real NOT NULL,
	"levyBase" real NOT NULL,
	"vatAmount" real NOT NULL,
	"totalTax" real NOT NULL,
	"grossTotal" real NOT NULL,
	"effectiveRate" real NOT NULL,
	"ratesSnapshot" jsonb NOT NULL,
	"notes" text,
	"createdById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planId" uuid NOT NULL,
	"procedureName" text NOT NULL,
	"treatmentTypeId" uuid,
	"toothNumber" integer,
	"phase" integer DEFAULT 1 NOT NULL,
	"estimatedCost" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"appointmentId" uuid,
	"notes" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"title" text NOT NULL,
	"totalEstimated" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"presentedAt" timestamp,
	"acceptedAt" timestamp,
	"declinedAt" timestamp,
	"completedAt" timestamp,
	"signatureData" text,
	"signedByName" text,
	"signedRelationship" text,
	"notes" text,
	"createdById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xray_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patientId" uuid NOT NULL,
	"xrayTypeId" uuid,
	"source" text DEFAULT 'internal' NOT NULL,
	"toothNumber" integer,
	"imageUrl" text NOT NULL,
	"thumbnailUrl" text,
	"capturedAt" timestamp,
	"externalClinicName" text,
	"externalCapturedDate" timestamp,
	"uploadedById" text,
	"uploadedAt" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "xray_share_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shareLinkId" uuid NOT NULL,
	"accessedAt" timestamp DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"action" text NOT NULL,
	"xrayRecordId" uuid
);
--> statement-breakpoint
CREATE TABLE "xray_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"linkToken" text NOT NULL,
	"accessCode" text NOT NULL,
	"xrayRecordIds" jsonb NOT NULL,
	"patientId" uuid NOT NULL,
	"recipientName" text NOT NULL,
	"recipientContact" text,
	"createdById" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"revokedAt" timestamp,
	"revokedById" text,
	"accessCount" integer DEFAULT 0 NOT NULL,
	"verifiedAt" timestamp,
	CONSTRAINT "xray_share_links_linkToken_unique" UNIQUE("linkToken")
);
--> statement-breakpoint
CREATE TABLE "xray_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"displayName" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "xray_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "confirmationToken" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "confirmationSentAt" timestamp;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "confirmationResponse" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "confirmationRespondedAt" timestamp;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "checkedInAt" timestamp;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "inChairAt" timestamp;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "completedAt" timestamp;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "beforeJson" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "afterJson" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "changedFields" text[];--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "status" text DEFAULT 'paid';--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "paidAt" timestamp;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "deferredReason" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "deferredById" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "linkedEntityType" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "linkedEntityId" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "createdById" text;--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "expiryDate" timestamp;--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "lotNumber" text;--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "supplierId" uuid;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "treatmentTypeId" uuid;--> statement-breakpoint
ALTER TABLE "treatment_types" ADD COLUMN "defaultRecallMonths" integer;--> statement-breakpoint
ALTER TABLE "website_bookings" ADD COLUMN "source" text DEFAULT 'website';--> statement-breakpoint
ALTER TABLE "website_bookings" ADD COLUMN "patientId" uuid;--> statement-breakpoint
ALTER TABLE "website_bookings" ADD COLUMN "requestType" text DEFAULT 'new';--> statement-breakpoint
ALTER TABLE "website_bookings" ADD COLUMN "relatedAppointmentId" uuid;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD CONSTRAINT "clinic_settings_updatedById_user_id_fk" FOREIGN KEY ("updatedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form_templates" ADD CONSTRAINT "consent_form_templates_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_pricing_documents" ADD CONSTRAINT "insurance_pricing_documents_companyId_insurance_companies_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."insurance_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_pricing_documents" ADD CONSTRAINT "insurance_pricing_documents_uploadedById_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_reconciliation_entries" ADD CONSTRAINT "insurance_reconciliation_entries_companyId_insurance_companies_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."insurance_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_reconciliation_entries" ADD CONSTRAINT "insurance_reconciliation_entries_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_reconciliation_entries" ADD CONSTRAINT "insurance_reconciliation_entries_recordedById_user_id_fk" FOREIGN KEY ("recordedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_case_photos" ADD CONSTRAINT "lab_case_photos_labCaseId_lab_cases_id_fk" FOREIGN KEY ("labCaseId") REFERENCES "public"."lab_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_case_photos" ADD CONSTRAINT "lab_case_photos_uploadedById_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_vendorId_lab_vendors_id_fk" FOREIGN KEY ("vendorId") REFERENCES "public"."lab_vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_serviceId_lab_services_id_fk" FOREIGN KEY ("serviceId") REFERENCES "public"."lab_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_services" ADD CONSTRAINT "lab_services_vendorId_lab_vendors_id_fk" FOREIGN KEY ("vendorId") REFERENCES "public"."lab_vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_uploadedById_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_odontogram" ADD CONSTRAINT "patient_odontogram_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_odontogram" ADD CONSTRAINT "patient_odontogram_recordedById_user_id_fk" FOREIGN KEY ("recordedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_perio_entries" ADD CONSTRAINT "patient_perio_entries_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_perio_entries" ADD CONSTRAINT "patient_perio_entries_recordedById_user_id_fk" FOREIGN KEY ("recordedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_photos" ADD CONSTRAINT "patient_photos_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_photos" ADD CONSTRAINT "patient_photos_uploadedById_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_reminders" ADD CONSTRAINT "patient_reminders_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_reminders" ADD CONSTRAINT "patient_reminders_assignedToId_user_id_fk" FOREIGN KEY ("assignedToId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_reminders" ADD CONSTRAINT "patient_reminders_completedById_user_id_fk" FOREIGN KEY ("completedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_reminders" ADD CONSTRAINT "patient_reminders_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_dismissedById_user_id_fk" FOREIGN KEY ("dismissedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_contactedById_user_id_fk" FOREIGN KEY ("contactedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_consent_forms" ADD CONSTRAINT "signed_consent_forms_templateId_consent_form_templates_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."consent_form_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_consent_forms" ADD CONSTRAINT "signed_consent_forms_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_consent_forms" ADD CONSTRAINT "signed_consent_forms_collectedById_user_id_fk" FOREIGN KEY ("collectedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_staffId_staff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_calculations" ADD CONSTRAINT "tax_calculations_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_calculations" ADD CONSTRAINT "tax_calculations_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_planId_treatment_plans_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."treatment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_records" ADD CONSTRAINT "xray_records_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_records" ADD CONSTRAINT "xray_records_xrayTypeId_xray_types_id_fk" FOREIGN KEY ("xrayTypeId") REFERENCES "public"."xray_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_records" ADD CONSTRAINT "xray_records_uploadedById_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_share_access_log" ADD CONSTRAINT "xray_share_access_log_shareLinkId_xray_share_links_id_fk" FOREIGN KEY ("shareLinkId") REFERENCES "public"."xray_share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_share_links" ADD CONSTRAINT "xray_share_links_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_share_links" ADD CONSTRAINT "xray_share_links_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_share_links" ADD CONSTRAINT "xray_share_links_revokedById_user_id_fk" FOREIGN KEY ("revokedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deferredById_user_id_fk" FOREIGN KEY ("deferredById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;