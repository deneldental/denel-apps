-- PR-16 — specialists gain a `specialty` (free-text label like "Orthodontist",
-- "Endodontist") and a `profileImage` URL for the avatar. Both nullable so
-- existing rows aren't disturbed.

ALTER TABLE "specialists"
  ADD COLUMN IF NOT EXISTS "specialty" text,
  ADD COLUMN IF NOT EXISTS "profile_image" text;
