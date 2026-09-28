/**
 * `serverSession` — create a Better Auth session for a user, from our own code.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * Two flows authenticate a staff member through rules Better Auth does not
 * know about, and then need a session:
 *
 *   1. `routes/staff-auth.ts` — phone+OTP login. It gates on
 *      `findActiveStaffByPhone` (no SMS to unknown or inactive numbers, which
 *      the phone-number plugin's own `send-otp` would happily send), and it
 *      honours trusted devices, which skip OTP entirely.
 *   2. `routes/kiosk.ts` — a paired station hands an operator a session after a
 *      PIN unlock. There is no OTP in that flow at all.
 *
 * Both used `issueStaffSession()` from the hand-rolled staff stack. Moving them
 * onto Better Auth is the point of the consolidation
 * (`project-docs/auth-consolidation-plan.md`), but Better Auth only creates
 * sessions inside its own endpoints — `internalAdapter.createSession()` is not
 * reachable as a plain API call.
 *
 * This plugin exposes exactly that one capability, so session creation happens
 * inside the kernel where `setSessionCookie` applies the right cookie prefix,
 * signature and attributes, and where the hooks fire.
 *
 * ─── Why it is not an open "become any user" endpoint ────────────────────────
 * Every Better Auth plugin endpoint is routed under `/api/auth/*`, so this one
 * is reachable over HTTP by construction. Unguarded it would be a total
 * authentication bypass: POST a userId, receive that user's session.
 *
 * The guard is that it refuses any call that arrived over HTTP. Better Auth
 * populates `ctx.request` only for requests routed through `auth.handler`;
 * in-process calls via `auth.api.createServerSession({ body })` leave it
 * undefined. So the endpoint serves our own code and 403s the internet.
 *
 * If a future refactor ever needs to call this from a real request context,
 * do NOT relax the guard — add an explicit authorisation check instead.
 */

import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import type { BetterAuthPlugin } from 'better-auth/types'
import * as z from 'zod'

export const SERVER_SESSION_PLUGIN_ID = 'server-session'

export const serverSession = () =>
  ({
    id: SERVER_SESSION_PLUGIN_ID,
    endpoints: {
      createServerSession: createAuthEndpoint(
        '/server-session/create',
        {
          method: 'POST',
          body: z.object({
            userId: z.string().min(1),
          }),
          metadata: {
            SERVER_ONLY: true,
          },
        },
        async (ctx) => {
          // The whole security model of this endpoint. `ctx.request` is set by
          // `auth.handler` for anything that came off the wire and is undefined
          // for in-process `auth.api.*` calls.
          if (ctx.request) {
            throw new APIError('FORBIDDEN', {
              message: 'Not available over HTTP',
              code: 'SERVER_ONLY_ENDPOINT',
            })
          }

          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId)
          if (!user) {
            throw new APIError('NOT_FOUND', {
              message: 'User not found',
              code: 'USER_NOT_FOUND',
            })
          }

          // Mirrors the account-status rule every other session reader uses
          // (lib/account-sessions.ts). A banned account must not be handed a
          // session by a side door — that is the H5 class of bug.
          const banned = user as { banned?: boolean | null; banExpires?: Date | null }
          const banLapsed = banned.banExpires ? banned.banExpires.getTime() < Date.now() : false
          if (banned.banned && !banLapsed) {
            throw new APIError('FORBIDDEN', {
              message: 'Account is banned',
              code: 'BANNED_USER',
            })
          }

          const session = await ctx.context.internalAdapter.createSession(user.id)
          if (!session) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Failed to create session',
              code: 'FAILED_TO_CREATE_SESSION',
            })
          }

          // Sets the signed cookie with this instance's prefix and attributes,
          // exactly as a normal sign-in would.
          await setSessionCookie(ctx, { session, user })

          return ctx.json({ status: true, token: session.token })
        }
      ),
    },
  }) satisfies BetterAuthPlugin
