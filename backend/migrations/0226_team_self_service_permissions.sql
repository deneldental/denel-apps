-- Team-app tabs move to self-service permissions (my_payslips, my_requests,
-- my_training); the admin payroll / staff_* grants leave the Team app.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- The Team app gated its Payslips, Requests and Training tabs on payroll:read,
-- staff_requests:read and staff_training:read. Those are the admin permissions
-- the staff-administration APIs (/api/payroll, /api/staff, /api/hr) check, so
-- every staff member could read everyone's pay, reviews and requests. The tabs
-- now gate on my_* permissions that no admin API accepts (access-control fix,
-- 2026-09-24). bundles.config.ts carries the new bundle contents and seed-rbac
-- re-syncs them; this migration moves the DATA that names the old modules:
--
--   1. the my_* permission rows, so step 3 can reference them before seed-rbac
--      runs (seed-rbac upserts the same rows and their descriptions);
--   2. the saved Team module allowlist (clinic_settings.pwa_enabled_modules) —
--      without this, a clinic that saved the list before today would lose the
--      three tabs, because routes/auth.ts strips every module not listed;
--   3. Team-app role matrices (role_permissions, scope 'pwa'): each old read
--      grant becomes its my_* equivalent, then every admin-grade payroll /
--      staff_* grant on the Team app is removed.
--
-- staff_performance maps to nothing: no Team tab ever gated on it (the Team
-- Performance page reads /api/staff-portal/performance, ungated).
--
-- Idempotent.

INSERT INTO permissions (module, action, description)
VALUES
  ('my_payslips', 'read', 'Team app: show the Payslips tab (own payslips)'),
  ('my_requests', 'read', 'Team app: show the Requests tab (own requests)'),
  ('my_training', 'read', 'Team app: show the Training tab (own training)')
ON CONFLICT (module, action) DO NOTHING;
--> statement-breakpoint
UPDATE clinic_settings
SET
  value = (
    SELECT COALESCE(jsonb_agg(DISTINCT mapped ORDER BY mapped), '[]'::jsonb)
    FROM (
      SELECT CASE elem
          WHEN 'payroll' THEN 'my_payslips'
          WHEN 'staff_requests' THEN 'my_requests'
          WHEN 'staff_training' THEN 'my_training'
          ELSE elem
        END AS mapped
      FROM jsonb_array_elements_text(clinic_settings.value) AS elem
      WHERE elem <> 'staff_performance'
    ) AS m
  ),
  "updatedAt" = now()
WHERE key = 'pwa_enabled_modules'
  AND jsonb_typeof(value) = 'array'
  AND value ?| ARRAY['payroll', 'staff_requests', 'staff_training', 'staff_performance'];
--> statement-breakpoint
INSERT INTO role_permissions ("roleId", "permissionId", scope)
SELECT DISTINCT rp."roleId", np.id, 'pwa'
FROM role_permissions rp
JOIN permissions op ON op.id = rp."permissionId" AND op.action = 'read'
JOIN permissions np ON np.action = 'read'
  AND np.module = CASE op.module
    WHEN 'payroll' THEN 'my_payslips'
    WHEN 'staff_requests' THEN 'my_requests'
    WHEN 'staff_training' THEN 'my_training'
  END
WHERE rp.scope = 'pwa'
  AND op.module IN ('payroll', 'staff_requests', 'staff_training')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM role_permissions rp
USING permissions p
WHERE rp."permissionId" = p.id
  AND rp.scope = 'pwa'
  AND p.module IN ('payroll', 'staff', 'staff_requests', 'staff_training', 'staff_performance');
