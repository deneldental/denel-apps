CREATE TABLE "staff_questionnaire_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staffId" uuid NOT NULL,
	"questionId" uuid NOT NULL,
	"weekStartDate" timestamp NOT NULL,
	"score" real NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staff_questionnaire_responses_staffId_questionId_weekStartDate_unique" UNIQUE("staffId","questionId","weekStartDate")
);
--> statement-breakpoint
ALTER TABLE "staff_questionnaire_responses" ADD CONSTRAINT "staff_questionnaire_responses_staffId_staff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_questionnaire_responses" ADD CONSTRAINT "staff_questionnaire_responses_questionId_staff_questionnaire_questions_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."staff_questionnaire_questions"("id") ON DELETE cascade ON UPDATE no action;