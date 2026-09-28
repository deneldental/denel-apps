import { api } from '@/lib/api-client'

/**
 * Tasks assigned to the signed-in user (via HR Tasks Management). Reuses the
 * shared `/api/tasks/*` endpoints — `getCurrentUser` on the backend resolves
 * both Better Auth (portal) and the staff phone+OTP session, so a receptionist
 * signed into the portal sees and completes the same assignments a Team-app
 * staffer would.
 */
export interface MyTask {
  assignmentId: string
  status: 'pending' | 'done'
  doneAt: string | null
  id: string
  title: string
  description: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  dueAt: string | null
}

export const getMyTasks = () => api.get<MyTask[]>('/api/tasks/mine')

export const setTaskStatus = (assignmentId: string, done: boolean) =>
  api.patch(`/api/tasks/assignments/${assignmentId}`, { status: done ? 'done' : 'pending' })
