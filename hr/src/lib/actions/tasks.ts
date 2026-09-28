import { api } from '@/lib/api-client'

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TaskRepeat = 'none' | 'daily' | 'weekly'
export type AssignmentStatus = 'pending' | 'done'

export interface TaskAssigneeSummary {
  id: string
  name: string
  status: AssignmentStatus
  doneAt: string | null
  isSelf: boolean
}

export interface TaskRow {
  id: string
  title: string
  description: string | null
  priority: TaskPriority
  dueAt: string | null
  repeat: TaskRepeat
  createdAt: string
  assigneeCount: number
  doneCount: number
  assignees: TaskAssigneeSummary[]
}

export interface MyTaskRow {
  assignmentId: string
  status: AssignmentStatus
  doneAt: string | null
  id: string
  title: string
  description: string | null
  priority: TaskPriority
  dueAt: string | null
  createdAt: string
}

export interface CreateTaskInput {
  title: string
  description?: string
  priority?: TaskPriority
  dueAt?: string | null
  repeat?: TaskRepeat
  assignees: { staffIds?: string[]; userIds?: string[] }
}

export interface ListTasksOpts {
  status?: 'open' | 'done'
  limit?: number
  offset?: number
}

export function listTasks(opts?: ListTasksOpts) {
  const p = new URLSearchParams()
  if (opts?.status) p.set('status', opts.status)
  if (opts?.limit != null) p.set('limit', String(opts.limit))
  if (opts?.offset != null) p.set('offset', String(opts.offset))
  const qs = p.toString()
  return api.get<TaskRow[]>(`/api/tasks${qs ? `?${qs}` : ''}`)
}

export function getMyTasks(opts?: { limit?: number; offset?: number }) {
  const p = new URLSearchParams()
  if (opts?.limit != null) p.set('limit', String(opts.limit))
  if (opts?.offset != null) p.set('offset', String(opts.offset))
  const qs = p.toString()
  return api.get<MyTaskRow[]>(`/api/tasks/mine${qs ? `?${qs}` : ''}`)
}

export function createTask(input: CreateTaskInput) {
  return api.post<{ id: string; assignments: number }>('/api/tasks', input)
}

export function setAssignmentStatus(assignmentId: string, status: AssignmentStatus) {
  return api.patch(`/api/tasks/assignments/${assignmentId}`, { status })
}

export function updateTask(
  id: string,
  patch: Partial<Pick<TaskRow, 'title' | 'description' | 'priority' | 'dueAt' | 'repeat'>>
) {
  return api.patch(`/api/tasks/${id}`, patch)
}

export function deleteTask(id: string) {
  return api.delete(`/api/tasks/${id}`)
}
