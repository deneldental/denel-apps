-- Portal and HR access follow the role: delete the redundant per-person
-- denials that onboarding used to write by default.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- HR onboarding wrote `user_scopes (portal, granted false)` for every new staff
-- member, and registration approval wrote a denial for each app the reviewer
-- left unticked. user_scopes overrides the role (PermissionEngine.checkScope),
-- so those rows kept blocking the app after any later role change: a staff
-- member promoted to receptionist still bounced off every portal page.
-- Onboarding no longer writes them (access-control fix, 2026-09-24).
--
-- A denial is redundant when the person's role does not grant that app
-- anyway — deleting it changes nobody's access today; it only stops the row
-- from overriding a future role. A denial that takes away something the role
-- DOES grant is a deliberate per-person exception and is kept. Team-app (pwa)
-- rows are left alone: onboarding never wrote a pwa denial; only offboarding
-- and the Edit-access switch do.
--
-- Idempotent.

DELETE FROM user_scopes us
WHERE us.granted = false
  AND us.interface_scope IN ('portal', 'hr')
  AND NOT EXISTS (
    SELECT 1
    FROM "user" u
    JOIN role_scopes rs
      ON rs."roleId" = u."roleId"
      AND rs.interface_scope = us.interface_scope
    WHERE u.id = us."userId"
  );
