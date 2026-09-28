// HR Handbook — the company's living policy document.
//
// Authored in the HR app with BlockNote and stored as its block-JSON document
// under one clinic-settings key on the backend. Read is open to any staff
// member; write is gated on settings:update server-side.

import { api } from '@/lib/api'

/** A BlockNote block. Kept loose here — the editor owns the concrete shape. */
export type HandbookBlock = Record<string, unknown>

export interface HandbookDoc {
  /** BlockNote block array, or null when the handbook has never been saved. */
  content: HandbookBlock[] | null
  updatedAt: string | null
  updatedBy: string | null
}

export function getHandbook() {
  return api.get<HandbookDoc>('/api/settings/hr-handbook')
}

export function saveHandbook(content: HandbookBlock[]) {
  return api.put<{ updatedAt: string }>('/api/settings/hr-handbook', { content })
}
