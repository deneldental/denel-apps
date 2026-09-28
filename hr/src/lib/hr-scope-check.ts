import type { ApiResponse } from '@denel/app-kit'
import { api } from './api'

export interface HrScopeAccess {
  hasAccess: boolean
  scope: string
}

let inFlight: Promise<ApiResponse<HrScopeAccess>> | null = null

/**
 * Starts (or reuses) the HR interface-scope check. Called eagerly below, at
 * module load, so it runs in parallel with AuthProvider's own session check
 * instead of waiting for RequireAuth to mount RequireHrAccess as its child —
 * the two backend round trips used to run strictly in series, doubling
 * cold-load latency on every protected-route visit.
 */
export function getHrScopeAccess(): Promise<ApiResponse<HrScopeAccess>> {
  if (!inFlight) {
    inFlight = api.get<HrScopeAccess>('/api/auth/scope-access?scope=hr')
  }
  return inFlight
}

/**
 * Drop the cached result whenever the signed-in identity changes — before
 * signing in and on sign-out — so the next check uses the new session. The
 * page-load check above runs while signed out on the login page, and reusing
 * its "no access" after sign-in used to show "No HR access" until a reload.
 */
export function resetHrScopeAccess() {
  inFlight = null
}

void getHrScopeAccess()
