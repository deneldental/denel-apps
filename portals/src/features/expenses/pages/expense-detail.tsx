import { Navigate } from 'react-router-dom'

/**
 * Expense detail moved to an in-page slide-in sheet on the Expenses list.
 * Keep this component as a redirect so legacy bookmarks of
 * `/expenses/view/:id` don't 404.
 */
export default function ExpenseDetailPage() {
  return <Navigate to="/expenses" replace />
}
