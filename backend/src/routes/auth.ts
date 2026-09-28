import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { env } from '../config/env'
import { getDb } from '../db'
import { clinicSettings, roleScopes, roles, user, userScopes } from '../db/schema'
import { logError } from '../lib/logger'
import {
  ACTIONS,
  getChildModules,
  isParentModule,
  MENU_ORDER,
  MODULE_MENU_CONFIG,
  MODULES,
} from '../lib/modules'
import { getCurrentUser, isAdminUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { getRoleBundleNames, resolveUserPermissions } from '../rbac/engine/BundleResolver'
import { PermissionEngine } from '../rbac/engine/PermissionEngine'
import { resolveAppScope } from '../rbac/middleware/detectInterface'
import { groupPermissionsByModule } from '../rbac/utils/wildcardMatch'

const authApp = new Hono<HonoEnv>()

/**
 * Paths under /api/auth that THIS router owns rather than Better Auth.
 *
 * The Better Auth catch-all (`app.all('/api/auth/*')`) is mounted ahead of this
 * router, so anything it does not explicitly pass through never reaches us and
 * 404s. `/check-permission` was missing from that list and was dead for exactly
 * that reason.
 *
 * Keep this in sync when adding a route below — app.ts reads it, so a new entry
 * here is all that is needed to make the route reachable.
 */
export const CUSTOM_AUTH_PATHS = new Set([
  '/api/auth/check-permission',
  '/api/auth/scope-access',
  '/api/auth/permissions',
])

// â”€â”€â”€ Permission check (used by frontend for individual gate checks) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

authApp.get('/check-permission', async (c) => {
  const sessionUser = await getCurrentUser(c)
  if (!sessionUser) return c.json({ success: true, data: { allowed: false } })

  const module = c.req.query('module')
  const action = c.req.query('action')
  if (!module || !action) return c.json({ error: 'Missing module or action' }, 400)

  const db = getDb(env.DATABASE_URL)
  const engine = new PermissionEngine(db)
  const appScope = resolveAppScope(c)
  const allowed = await engine.check(sessionUser.id, module, action, appScope)

  return c.json({ success: true, data: { allowed } })
})

// â”€â”€â”€ Scope check (used by frontend on app mount to verify interface access) â”€â”€

authApp.get('/scope-access', async (c) => {
  const sessionUser = await getCurrentUser(c)
  if (!sessionUser) return c.json({ success: true, data: { hasAccess: false } })

  const scope = c.req.query('scope') as 'portal' | 'pwa' | 'hr' | undefined
  if (!scope || !['portal', 'pwa', 'hr'].includes(scope)) {
    return c.json({ error: 'Missing or invalid scope. Use: portal | pwa | hr' }, 400)
  }

  const db = getDb(env.DATABASE_URL)
  const engine = new PermissionEngine(db)
  const hasAccess = await engine.checkScope(sessionUser.id, scope)

  return c.json({ success: true, data: { hasAccess, scope } })
})

// â”€â”€â”€ Full permissions payload (called once on app mount, cached in React context)

authApp.get('/permissions', async (c) => {
  const sessionUser = await getCurrentUser(c)
  if (!sessionUser) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const db = getDb(env.DATABASE_URL)

    const dbUser = await db.query.user.findFirst({
      where: eq(user.id, sessionUser.id),
    })

    // `roleId` alone decides this (L11). The old form also let a user through
    // on `dbUser.role === 'admin'` — Better Auth's own column — and then passed
    // `dbUser.roleId!` (null) straight into `resolveUserPermissions`. So the
    // one account shape the clause existed to accommodate was also the one
    // shape it crashed on. Now a user with no RBAC role gets the empty payload,
    // whatever Better Auth's column says.
    if (!dbUser?.roleId) {
      return c.json({
        success: true,
        data: {
          roleId: null,
          roleName: null,
          isAdmin: false,
          scopes: [],
          permissions: {},
          bundles: [],
          menuItems: [],
          accessibleModules: [],
        },
      })
    }

    const isAdmin = isAdminUser(dbUser)
    const dbRole = dbUser?.roleId
      ? await db.query.roles.findFirst({ where: eq(roles.id, dbUser.roleId) })
      : null

    // ——— Scopes ——————————————————————————————————————————————————————————————————————
    // Effective scopes = user overrides (if any) + role-level grants
    const userScopeRows = await db.select().from(userScopes).where(eq(userScopes.userId, dbUser.id))

    // Start with default role-level scope grants
    const roleScopeRows = dbUser?.roleId
      ? await db
          .select({ interfaceScope: roleScopes.interfaceScope })
          .from(roleScopes)
          .where(eq(roleScopes.roleId, dbUser.roleId))
      : []
    const defaultScopes = roleScopeRows.map((s) => s.interfaceScope)

    let effectiveScopes: string[] = [...defaultScopes]

    if (userScopeRows.length > 0) {
      // Per-user overrides exist — apply them as diffs on top of default role scopes
      for (const override of userScopeRows) {
        if (override.granted) {
          if (!effectiveScopes.includes(override.interfaceScope)) {
            effectiveScopes.push(override.interfaceScope)
          }
        } else {
          effectiveScopes = effectiveScopes.filter((s) => s !== override.interfaceScope)
        }
      }
    }

    // ——— Permissions —————————————————————————————————————————————————————————————————
    let permissionMap: Record<string, string[]>
    let bundleNames: string[]
    let accessibleModules: string[]

    // Scope permissions to the calling interface (portal vs pwa), using the
    // same resolver as enforcement. These previously used different signals —
    // this payload read Origin while checkPermission read X-App-Id — so the
    // nav could be built from one surface's grants while requests were enforced
    // against the other's.
    const appScope = resolveAppScope(c)

    if (isAdmin) {
      // Admin sees all modules — no bundle resolution needed
      permissionMap = {}
      bundleNames = []
      accessibleModules = Object.values(MODULES)
    } else {
      // Use the SAME resolver as enforcement (PermissionEngine → resolveUserPermissions):
      // role permissions PLUS per-user bundle grants. Resolving role-only here let a
      // user be backend-authorized (via a per-user bundle) yet see an empty nav.
      const resolved = await resolveUserPermissions(db, dbUser.id, dbUser.roleId!, appScope)
      permissionMap = groupPermissionsByModule(resolved)
      bundleNames = await getRoleBundleNames(db, dbUser.roleId!)

      // The receptionist/doctor labs overrides that used to sit here are gone.
      // They were a partial copy of the engine's hardcoded rules — this one only
      // stripped labs deletes, while the engine denied receptionists every
      // delete, so the UI rendered delete buttons on 12 modules that always
      // 403'd. Both copies are replaced by bundle grants, which this resolver
      // already returns.

      accessibleModules = Object.entries(permissionMap)
        .filter(([, actions]) => actions.includes(ACTIONS.READ))
        .map(([mod]) => mod)
    }

    // For PWA callers: enforce the admin-configured enabled-modules list.
    // Modules not in the list are stripped from permissionMap + accessibleModules
    // regardless of role grants — they are invisible to the PWA.
    if (appScope === 'pwa') {
      const [settingRow] = await db
        .select({ value: clinicSettings.value })
        .from(clinicSettings)
        .where(eq(clinicSettings.key, 'pwa_enabled_modules'))
        .limit(1)

      if (settingRow?.value) {
        const enabledModules = settingRow.value as string[]
        const enabledSet = new Set(enabledModules)
        accessibleModules = accessibleModules.filter((m) => enabledSet.has(m))
        for (const mod of Object.keys(permissionMap)) {
          if (!enabledSet.has(mod)) delete permissionMap[mod]
        }
      }
      // If key is absent, all PWA modules are enabled — no filtering needed.
    }

    // â”€â”€ Menu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const menuItems = buildHierarchicalMenu(accessibleModules, isAdmin)

    return c.json({
      success: true,
      data: {
        roleId: dbUser.roleId,
        roleName: dbRole?.name ?? null,
        isAdmin,
        scopes: effectiveScopes,
        permissions: permissionMap,
        bundles: bundleNames,
        menuItems,
        accessibleModules,
      },
    })
  } catch (error) {
    logError(error, { context: '[Auth] Error fetching permissions' })
    return c.json({ error: 'Failed to fetch permissions' }, 500)
  }
})

// â”€â”€â”€ Menu builder (preserved from v1, unchanged) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type HierarchicalMenuItem = {
  module: string
  label: string
  href: string
  iconName: string
  isChild?: boolean
  children?: HierarchicalMenuItem[]
}

function buildHierarchicalMenu(
  accessibleModules: string[],
  isAdmin: boolean
): HierarchicalMenuItem[] {
  const menuItems: HierarchicalMenuItem[] = []

  for (const module of MENU_ORDER) {
    const config = MODULE_MENU_CONFIG[module]
    if (!config) continue

    const hasAccess = isAdmin || accessibleModules.includes(module)
    if (!hasAccess) continue

    const menuItem: HierarchicalMenuItem = {
      module,
      label: config.label,
      href: config.href,
      iconName: config.iconName,
      isChild: config.isChild,
    }

    if (isParentModule(module)) {
      const childModules = getChildModules(module)
      const accessibleChildren: HierarchicalMenuItem[] = []

      for (const childModule of childModules) {
        const childConfig = MODULE_MENU_CONFIG[childModule]
        if (!childConfig) continue
        const childHasAccess = isAdmin || accessibleModules.includes(childModule) || hasAccess
        if (childHasAccess) {
          accessibleChildren.push({
            module: childModule,
            label: childConfig.label,
            href: childConfig.href,
            iconName: childConfig.iconName,
            isChild: true,
          })
        }
      }

      if (accessibleChildren.length > 0) {
        menuItem.children = accessibleChildren
      }
    }

    menuItems.push(menuItem)
  }

  return menuItems
}

export { authApp }
