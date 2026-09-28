import { Outlet } from 'react-router-dom'

/**
 * Clinical module uses an in-page tab strip (Cases / Treatments / Prescriptions)
 * rather than a left rail. The actual tab UI lives in `clinical-page.tsx` so
 * we can share a single page mount across all three slugs.
 */
export function ClinicalLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Outlet />
    </div>
  )
}
