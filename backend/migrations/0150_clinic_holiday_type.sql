-- Half-day holidays: 'full' = non-scoring day for everyone; 'half' = clinic
-- closes early (day still scores on clock-in, early clock-out penalty waived).
ALTER TABLE "clinic_holidays" ADD COLUMN IF NOT EXISTS "type" text DEFAULT 'full' NOT NULL;
