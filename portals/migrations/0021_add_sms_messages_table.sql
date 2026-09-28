CREATE TABLE IF NOT EXISTS "sms_messages" (
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

-- Add foreign key constraints
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_patientId_patients_id_fk" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL;
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_sentById_user_id_fk" FOREIGN KEY ("sentById") REFERENCES "user"("id") ON DELETE SET NULL;
