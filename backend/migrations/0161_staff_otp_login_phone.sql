-- Staff phone+OTP auth (Phase 2): allow the new 'login_phone' OTP purpose
-- (passwordless staff PWA login) alongside the existing device/reset purposes.
ALTER TABLE "staff_otp_codes" DROP CONSTRAINT IF EXISTS "staff_otp_codes_purpose_check";
--> statement-breakpoint
ALTER TABLE "staff_otp_codes" ADD CONSTRAINT "staff_otp_codes_purpose_check"
  CHECK ("purpose" = ANY (ARRAY['password_reset'::text, 'login_device'::text, 'login_phone'::text]));
