/**
 * Compatibility surface for migrated portal features that import
 * `{ api, API_BASE_URL }` from `@/lib/api-client`. The HR app's canonical
 * client lives in `@/lib/api` (built on `@denel/app-kit`); this re-exports it
 * under the path the moved feature code expects, so feature files move with
 * zero edits to their API imports.
 */

export type { ApiResponse } from '@denel/app-kit'
export { api } from './api'

export const API_BASE_URL = import.meta.env.VITE_API_URL || ''
