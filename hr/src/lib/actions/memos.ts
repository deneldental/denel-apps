import { api } from '@/lib/api-client'

export type MemoVideoMeta = {
  id: string
  title: string
  thumbnail: string
  embedUrl: string
}

/** Resolve a YouTube URL to { id, title, thumbnail, embedUrl } (server-side oEmbed). */
export async function getVideoMeta(url: string) {
  return api.get<MemoVideoMeta>(`/api/staff/memos/video-meta?url=${encodeURIComponent(url)}`)
}

export type MemoAckRow = {
  id: string
  staffId: string
  staffName: string
  acknowledgedAt: string
}

export type MemoAcknowledgements = {
  memoId: string
  targetCount: number
  acknowledgedCount: number
  acknowledged: MemoAckRow[]
  pending: Array<{ id: string; name: string }>
}

/** Admin read-receipt view: who has / hasn't acknowledged a published memo. */
export async function getMemoAcknowledgements(memoId: string) {
  return api.get<MemoAcknowledgements>(`/api/staff/memos/${memoId}/acknowledgements`)
}

export type MemoPublishResult = {
  notified?: { pushed: number; texted: number }
}

/** Publish (or unpublish) a memo. Publishing for the first time notifies the audience. */
export async function setMemoPublished(memoId: string, published: boolean) {
  return api.patch<MemoPublishResult>(`/api/staff/memos/${memoId}/publish`, { published })
}

/** Re-notify only the target staff who haven't yet acknowledged a published memo. */
export async function notifyUnreadMemo(memoId: string) {
  return api.post<{ pushed: number; texted: number; pending: number }>(
    `/api/staff/memos/${memoId}/notify-unread`,
    {}
  )
}
