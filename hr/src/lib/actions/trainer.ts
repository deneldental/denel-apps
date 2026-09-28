import { api } from '@/lib/api-client'

/**
 * Training-authoring API for the trainer surface (external_trainer + hr_admin).
 * Hits the existing `/api/staff/training/*` endpoints via the HR app's api
 * client. Ported from the PWA's `trainerApi`.
 */
export const trainerApi = {
  getModules: () => api.get('/api/staff/training/all'),
  getModule: (id: string) => api.get(`/api/staff/training/${id}`),
  createModule: (data: {
    title: string
    description?: string
    published?: boolean
    allowReassessment?: boolean
    blocks?: unknown[]
    assignedTo?: string[]
    materialType?: 'module' | 'quiz'
    quizQuestions?: unknown[]
    quizTimer?: number | null
    passingScore?: number | null
  }) =>
    api.post<{ id: string }>('/api/staff/training', {
      ...data,
      materialType: data.materialType ?? 'module',
    }),
  updateModule: (id: string, data: Record<string, unknown>) =>
    api.patch(`/api/staff/training/${id}`, data),
  deleteModule: (id: string) => api.delete(`/api/staff/training/${id}`),
  getLearners: () => api.get('/api/staff/training/learners'),
  // Assessments — completed quiz attempts on this trainer's modules
  getAssessments: (status?: 'pending' | 'reviewed') =>
    api.get(`/api/staff/training/assessments${status ? `?status=${status}` : ''}`),
  getAssessment: (id: string) => api.get(`/api/staff/training/assessments/${id}`),
  reviewAssessment: (id: string, payload: { trainerFeedback?: string }) =>
    api.patch(`/api/staff/training/assessments/${id}`, payload),
}
