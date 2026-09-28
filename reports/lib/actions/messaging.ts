import { api } from '@/lib/api-client'

// Get messages for current user
export async function getMessages() {
  return api.get<any[]>('/api/messages')
}

export async function sendMessage(receiverId: string, content: string) {
  const res = await api.post<any>('/api/messages', { receiverId, content })
  return res
}
