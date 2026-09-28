-- admin-v1 CC.3 — kiosk / device-pairing framework tables. Additive, idempotent.

CREATE TABLE IF NOT EXISTS "kiosk_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "label" text NOT NULL,
  "location" text,
  "surface" text NOT NULL,
  "pairingCodeHash" text,
  "pairingExpiresAt" timestamp,
  "deviceTokenHash" text,
  "pairedAt" timestamp,
  "lastSeenAt" timestamp,
  "isActive" boolean DEFAULT true NOT NULL,
  "revokedAt" timestamp,
  "pairedById" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kiosk_operators" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staffId" uuid NOT NULL,
  "pinHash" text NOT NULL,
  "capabilities" jsonb DEFAULT '{}' NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "failedAttempts" integer DEFAULT 0 NOT NULL,
  "lockedUntil" timestamp,
  "sessionEpoch" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kiosk_operators_staffId_staff_id_fk') THEN
    ALTER TABLE "kiosk_operators" ADD CONSTRAINT "kiosk_operators_staffId_staff_id_fk"
      FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
-- One active operator record per staff member.
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_operators_staffId_unique" ON "kiosk_operators" ("staffId");
