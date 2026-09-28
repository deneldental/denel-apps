// PR-20 — the single-memo view is now a slide-in Sheet on the memos list
// (UI consistency with the create-memo flow). This page exists only to
// preserve deep links / old bookmarks: it bounces to /hr/memos and hands
// the id off via location.state, where the list page opens the detail
// Sheet for it. Returns no DOM beyond a brief loading shimmer.

import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'

export default function MemoDetailPage() {
  const { id } = useParams<{ id: string }>()

  // Guard against the empty-id case where react-router would let an
  // undefined `id` fall through to the list with no detail intent.
  useEffect(() => {
    if (!id) return
  }, [id])

  if (!id) return <Navigate to="/memos" replace />
  return <Navigate to="/memos" replace state={{ detailMemoId: id }} />
}
