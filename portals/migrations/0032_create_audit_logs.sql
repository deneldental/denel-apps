-- Create audit logs table
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "action" text NOT NULL,
    "module" text NOT NULL,
    "entityId" text,
    "entityName" text,
    "changes" jsonb,
    "ipAddress" text,
    "userAgent" text,
    "createdAt" timestamp NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs("userId");
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs("module");
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs("createdAt");
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs("entityId");
