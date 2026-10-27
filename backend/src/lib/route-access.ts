/**
 * "May this person use this endpoint, from this app?" — the one helper for routes that used to
 * check only that someone was signed in (F23).
 *
 * A rule names the apps that may call the endpoint and the module permissions that serve it (any ONE
 * of them is enough). It answers with the 403 the route should return, or `null` to carry on. App
 * means the surface the request comes from (`resolveAppScope`): the clinic portal, the Team app
 * (`pwa`) or the HR app. An endpoint that exists for the clinic portal says `apps: ['portal']`, so a
 * Team-app or HR session that happens to hold a same-named grant still cannot reach it.
 */
import type { Context } from 'hono'
import { resolveAppScope } from '../rbac/middleware/detectInterface'
import { checkPermission } from './rbac'
import type { HonoEnv } from './types'

export type AppName = 'portal' | 'pwa' | 'hr'
export type Permission = readonly [module: string, action: string]

export interface AccessRule {
  /** The apps that may call the endpoint at all. Omit for "any app" (the permission still applies). */
  apps?: readonly AppName[]
  /** Any one of these module/action pairs is enough. Omit for "no module permission needed". */
  anyOf?: readonly Permission[]
  /** Apps in which being signed in is enough (the Team app's own self-service reads). */
  openIn?: readonly AppName[]
}

/** True when the person holds at least one of the module/action pairs, as the current app resolves them. */
export async function hasAnyPermission(
  c: Context<HonoEnv>,
  userId: string,
  anyOf: readonly Permission[]
): Promise<boolean> {
  for (const [module, action] of anyOf) {
    if (await checkPermission(c, userId, module, action)) return true
  }
  return false
}

/** `null` when the caller may proceed, otherwise the 403 response to return. */
export async function denyUnless(
  c: Context<HonoEnv>,
  userId: string,
  rule: AccessRule
): Promise<Response | null> {
  const refuse = () => c.json({ error: 'Unauthorized' }, 403)
  const app = resolveAppScope(c) as AppName

  if (rule.apps && !rule.apps.includes(app)) return refuse()
  if (rule.openIn?.includes(app)) return null
  if (rule.anyOf?.length && !(await hasAnyPermission(c, userId, rule.anyOf))) return refuse()
  return null
}
