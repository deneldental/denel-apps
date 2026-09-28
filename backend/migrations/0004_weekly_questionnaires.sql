CREATE TABLE "staff_questionnaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdById" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_questionnaire_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"questionnaireId" uuid NOT NULL,
	"text" text NOT NULL,
	"scale" text DEFAULT '1-5' NOT NULL,
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_questionnaires" ADD CONSTRAINT "staff_questionnaires_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_questionnaire_questions" ADD CONSTRAINT "staff_questionnaire_questions_questionnaireId_staff_questionnaires_id_fk" FOREIGN KEY ("questionnaireId") REFERENCES "public"."staff_questionnaires"("id") ON DELETE cascade ON UPDATE no action;