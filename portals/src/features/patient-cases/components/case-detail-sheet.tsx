// The CaseDetailSheet component that used to live here had zero importers
// (patient-records-and-scheduling-audit.md LOW — dead code, superseded by
// case-detail-page.tsx). Removed; this file now only holds the CaseStage
// type, which 4 other files still import from this path.

export type CaseStage = {
  id: string
  caseId: string
  stageType: string
  data: Record<string, unknown>
  status?: string
  /** Calendar day (YYYY-MM-DD) of the visit this stage belongs to. */
  visitDate?: string | null
  planItemId?: string | null
  createdAt: string
  createdBy: { id: string; name: string } | null
}
